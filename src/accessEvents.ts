import { UnionUndefined } from "./misc";

type WatchWriteCallbacks = {
    write: (path: EyeTypes.Path2) => void;
    writeKey: (parentPath: EyeTypes.Path2, childKey: PropertyKey, change: "add"|"remove") => void;
};
type WatchReadCallbacks = {
    read: (path: EyeTypes.Path2) => void;
    readKeys: (path: EyeTypes.Path2) => void;
    readDelta?: (delta: ReadDelta) => void;
};


export type ReadDelta = {
    /** The same fullReads is passed each time, and so when the same fullReads is passed the delta
     *      of the last values is in readsAdded and readsRemoved.
     */
    fullReads: Map<string, { path: EyeTypes.Path2; }>;
    readsAdded: Map<string, EyeTypes.Path2>;
    readsRemoved: Map<string, EyeTypes.Path2>;
};

let watchCallbacksSeqNum = 0;
let watchCallbacksLookup: { [seqNum: number]: WatchWriteCallbacks } = Object.create(null);

let g = new Function("return this")();
g.watchCallbacksLookup = watchCallbacksLookup;

// We trigger the last of each list.
let readCallbacks: WatchReadCallbacks[][] = [];

export function watchAccesses(
    watchCallbacks: WatchWriteCallbacks
): {
    unwatch: () => void
} {
    let seqNum = watchCallbacksSeqNum++;
    watchCallbacksLookup[seqNum] = watchCallbacks;
    return {
        unwatch() {
            delete watchCallbacksLookup[seqNum];
        }
    };
}

export function getReads<T>(
    code: () => T,
    callbacks: WatchReadCallbacks,
    /** If true, it means that the caller of getReads handles notifying its parent of state changes when its
     *      reads change. For example, a component notifies its parent (the framework) when it's render function changes,
     *      (through this.forceUpdate, and this.setState) even though its parent also notifies it when props change.
     *      In these cases as the child will trigger the parents anyway, it is more efficient for the parent to ignore
     *      child reads, and so this flag hides child reads from the parent getReads calls, recursively while parent calls
     *      also set this flag to true.
     */
    callerHandlesNotifyingParent: boolean
): T {

    if(callerHandlesNotifyingParent) {
        if(readCallbacks.length === 0) readCallbacks.push([]);
        readCallbacks[readCallbacks.length - 1].push(callbacks);
    } else {
        readCallbacks.push([callbacks]);
    }

    try {
        return code();
    } finally {

        if(callerHandlesNotifyingParent) {
            readCallbacks[readCallbacks.length - 1].pop();
            if(readCallbacks[readCallbacks.length - 1].length === 0) {
                // Should only trigger for readCallbacks[0]
                readCallbacks.pop();
            }
        } else {
            readCallbacks.pop();
        }
    }
}

export function registerReadAccess(path: EyeTypes.Path2) {
    console.log(`Read`, path);
    for(let callbacksList of readCallbacks) {
        let callbacks = callbacksList[callbacksList.length - 1];
        callbacks.read(path);
    }
}

export function registerKeysReadAccess(path: EyeTypes.Path2) {
    console.log(`Read keys`, path);
    for(let callbacksList of readCallbacks) {
        let callbacks = callbacksList[callbacksList.length - 1];
        callbacks.readKeys(path);
    }
}

export function registerDeltaReadAccess(delta: ReadDelta) {
    for(let callbacksList of readCallbacks) {
        let callbacks = callbacksList[callbacksList.length - 1];
        if(callbacks.readDelta) {
            console.log(`Read delta keys`, delta.fullReads);
            callbacks.readDelta(delta);
        } else {
            for(let [key, read] of delta.fullReads) {
                registerReadAccess(read.path);
            }
        }
    }
}


// TODO: Allow write takebacks. As in, if a user does:
//      if(this.x === 0) { this.x = 1; this.x = 0; }
//  We need to trigger the write on `this.x = 1`, but on `this.x = 0` we want to take back the write, as nothing really changed.
//  - This will require some kind of writeCancel callback in our watch callbacks.
export function registerWrite(path: EyeTypes.Path2) {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.write(path);
        } catch(e) {
            console.error(`write access callback threw an error`, e);
        }
    }
}

export function registerOwnKeysWrite(parentPath: EyeTypes.Path2, childKey: PropertyKey, change: "add"|"remove") {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.writeKey(parentPath, childKey, change);
        } catch(e) {
            console.error(`write access callback threw an error`, e);
        }
    }
}