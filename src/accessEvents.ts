type WatchCallbacks = {
    read: (path: EyeTypes.Path2) => void;
    readKeys: (path: EyeTypes.Path2) => void;
    write: (path: EyeTypes.Path2) => void;
    writeKey: (parentPath: EyeTypes.Path2, childKey: PropertyKey, change: "add"|"remove") => void;
};

let watchCallbacksSeqNum = 0;
let watchCallbacksLookup: { [seqNum: number]: WatchCallbacks } = Object.create(null);

export function watchAccesses(
    watchCallbacks: WatchCallbacks
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

export function registerReadAccess(path: EyeTypes.Path2) {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.read(path);
        } catch(e) {
            console.error(`read access callback threw an error`, e);
        }
    }
}

export function registerKeysReadAccess(path: EyeTypes.Path2) {
    for(let key in watchCallbacksLookup) {
        let pendingAccess = watchCallbacksLookup[key];
        try {
            pendingAccess.readKeys(path);
        } catch(e) {
            console.error(`read access callback threw an error`, e);
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