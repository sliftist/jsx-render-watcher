import { UnionUndefined } from "./misc";

type WatchWriteCallbacks = {
    write: (path: EyeTypes.Path2) => void;
    writeKey: (parentPath: EyeTypes.Path2, childKey: PropertyKey, change: "add"|"remove") => void;
};
type WatchReadCallbacks = {
    read: (path: EyeTypes.Path2) => void;
    readKeys: (path: EyeTypes.Path2) => void;
};

let watchCallbacksSeqNum = 0;
let watchCallbacksLookup: { [seqNum: number]: WatchWriteCallbacks } = Object.create(null);

let g = new Function("return this")();
g.watchCallbacksLookup = watchCallbacksLookup;

let readCallbacks: WatchReadCallbacks[] = [];

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

/** Nested calls are namespaced, not triggering reads in parent calls. */
export function getReads(code: () => void, callbacks: WatchReadCallbacks) {
    readCallbacks.push(callbacks);
    try {
        code();
    } finally {
        readCallbacks.pop();
    }
}

export function registerReadAccess(path: EyeTypes.Path2) {
    let callbacks = UnionUndefined(readCallbacks[readCallbacks.length - 1]);
    if(callbacks) {
        callbacks.read(path);
    }
}

export function registerKeysReadAccess(path: EyeTypes.Path2) {
    let callbacks = UnionUndefined(readCallbacks[readCallbacks.length - 1]);
    if(callbacks) {
        callbacks.readKeys(path);
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