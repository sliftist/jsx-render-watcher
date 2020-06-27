import { UnionUndefined } from "./lib/misc";
import { derivedTotalReads } from "./derivedStats";

type WatchWriteCallbacks = {
    write: (hash: string) => void;
    // To indicate a the in operator for a lookup eyeLookup[parentPath] has changed value (a there is a key where "key in lookup"
    //  has changed it's boolean output).
    writeKey: (parentPath: string) => void;
};
type WatchReadCallbacks = {
    read: (hash: string) => void;
    readKeys: (hash: string) => void;
    readDelta?: (delta: ReadDelta) => void;
};


export type ReadDelta = {
    // All keys are path.pathHash
    /** The same fullReads is passed each time, and so when the same fullReads is passed the delta
     *      of the last values is in readsAdded and readsRemoved.
     */
    fullReads: Set<string>;
    readsAdded: Set<string>;
    readsRemoved: Set<string>;
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

export function registerReadAccess(hash: string) {
    //console.log(`Read`, hash);
    for(let callbacksList of readCallbacks) {
        derivedTotalReads.value++;
        let callbacks = callbacksList[callbacksList.length - 1];
        callbacks.read(hash);
    }
}

/** Called when Object.keys(parent) is called. Only registers an access to the children of an object,
 *      so if you do Object.keys(obj.x), you should register a read access of [obj, "x"], and the keys of the object
 *      at obj.x (they should be different hashes).
 */
export function registerKeysReadAccess(parentHash: string) {
    //console.log(`Read keys`, parentHash);
    for(let callbacksList of readCallbacks) {
        derivedTotalReads.value++;
        let callbacks = callbacksList[callbacksList.length - 1];
        callbacks.readKeys(parentHash);
    }
}

export function registerDeltaReadAccess(delta: ReadDelta) {
    for(let callbacksList of readCallbacks) {
        let callbacks = callbacksList[callbacksList.length - 1];
        if(callbacks.readDelta) {
            derivedTotalReads.value++;
            //console.log(`Read delta keys`, delta.fullReads);
            callbacks.readDelta(delta);
        } else {
            for(let key of delta.fullReads) {
                derivedTotalReads.value++;
                registerReadAccess(key);
            }
        }
    }
}


// TODO: Allow write takebacks. As in, if a user does:
//      if(this.x === 0) { this.x = 1; this.x = 0; }
//  We need to trigger the write on `this.x = 1`, but on `this.x = 0` we want to take back the write, as nothing really changed.
//  - This will require some kind of writeCancel callback in our watch callbacks.
export function registerWrite(hash: string) {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.write(hash);
        } catch(e) {
            if(g.TEST) throw e;
            console.error(`write access callback threw an error`, e);
        }
    }
}

export function registerOwnKeysWrite(pathHash: string) {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.writeKey(pathHash);
        } catch(e) {
            if(g.TEST) throw e;
            console.error(`write access callback threw an error`, e);
        }
    }
}