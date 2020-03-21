import { EyeMark, EyeType, EyePath } from "./eye";
import { watchAccesses, getReads } from "./accessEvents";
import { insertIntoListMapped, compareString, isEmpty, binarySearchMapped } from "./algorithms";
import { getParentHash } from "./path";
import { g } from "./misc";
import { exposeDebugLookup } from "./debugUtils/exposeDebug";

// NOTE: At the end of the day, this requires a code() callback, instead of "startWatch" and "endWatch" functions, simply
//      for performance reasons. Keeping track of changes takes memory, and so we don't want to keep track of changes
//      indefinitely. If we exposed a "startWatch" function and the "endWatch" wasn't called, we would have to keep track of
//      changes in perpetuity, which will explicitly be a memory leak.

// TODO: getAccesses should support delta based behavior.
//  1) The `code` function should be able to cache the previous output, and take instructions from code (via a
//      register call) that certain children read/writes should be kept mostly the same, with only specific modification
//      (add/remove).
//  2) getAccesses should support outputting this delta based information directly, indicating children are unchanged,
//      except for specific add/removes.
//  - The output can stay mostly the same, except both reads and writes will have added/removed properties.

export type AccessState = {
    reads: { [pathHash: string]: EyeTypes.Path2 };
    keyReads: { [pathHash: string]: EyeTypes.Path2 };
    writes: { [pathHash: string]: EyeTypes.Path2 };
};

/** Runs code, and returns the reads/writes. */
export function getAccesses(
    code: () => void
): DeepReadonly<AccessState> {
    let accesses: AccessState = {
        reads: Object.create(null),
        keyReads: Object.create(null),
        writes: Object.create(null),
    };
    getReads(code, {
        read(path) {
            accesses.reads[path.pathHash] = path;
        },
        readKeys(path) {
            accesses.keyReads[path.pathHash] = path;
        },
    });
    return accesses;
}


// TODO: Expose (to some kind of debug utility) the information of which watcher is triggering which watcher (we know if we are an watcher,
//  because it will be within a getAccesses call). Of course it may be from a raw location, in which case getting the location information
//  (via new Error()) is more expensive, but we should support it in some way.
type PathsWatched = {
    [pathHash: string]: {
        path: EyeTypes.Path2;
        callbacks: {
            [eyeOutputPathHash: string]: {
                callback: (path: EyeTypes.Path2) => void
            }
        };
    }
};
type WatcherPaths = {
    [eyeOutputPathHash: string]: {
        [pathHash: string]: true
    }
};


let pathsWatched: PathsWatched = Object.create(null);
let keysPathsWatched: PathsWatched = Object.create(null);

let eyePathsWatched: WatcherPaths = Object.create(null);
let keysEyePathsWatched: WatcherPaths = Object.create(null);

exposeDebugLookup("eyePathsWatched", eyePathsWatched, x => eyePathsWatched = x);

(g as any).eyePathsWatched = eyePathsWatched;
(g as any).keysEyePathsWatched = keysEyePathsWatched;

function trigger(pathHash: string, pathsWatched: PathsWatched) {
    let callbacksObj = pathsWatched[pathHash];
    if(!callbacksObj) return;

    let { callbacks } = callbacksObj;
    for(let callback of Object.values(callbacks).map(x => x.callback)) {
        callback(callbacksObj.path);
    }
}

watchAccesses({
    write(path) {
        console.log("write", path);
        trigger(path.pathHash, pathsWatched);
    },
    writeKey(parentPath, childKey, change) {
        console.log("change key", parentPath.pathHash, childKey, change);
        trigger(parentPath.pathHash, keysPathsWatched);
    }
});

export function unwatchPaths(accessId: string) {
    watchPaths({ keyReads: Object.create(null), reads: Object.create(null) }, () => {}, accessId);
}

/** Calls callback whenever any of the read paths OR their parents are changed.
 *      Will replace any existing callbacks on eyeOutput. If paths is empty, just removes all callbacks.
*/
export function watchPaths(
    pathsObj: Omit<AccessState, "writes">,
    callback: (path: EyeTypes.Path2) => void,
    accessId: string,
): void {
    let pathHash = accessId;

    subscribe(pathsObj.reads, pathsWatched, eyePathsWatched);
    subscribe(pathsObj.keyReads, keysPathsWatched, keysEyePathsWatched);

    function subscribe(paths: AccessState["keyReads"]|AccessState["reads"], pathsWatched: PathsWatched, eyePathsWatched: WatcherPaths) {
        eyePathsWatched[pathHash] = eyePathsWatched[pathHash] || Object.create(null);
        let prevPaths = eyePathsWatched[pathHash];

        // Add paths that are watched
        for(let key in paths) {
            let path = paths[key];
            pathsWatched[path.pathHash] = pathsWatched[path.pathHash] || { path, callbacks: Object.create(null) };
            pathsWatched[path.pathHash].callbacks[pathHash] = { callback };
            prevPaths[key] = true;
        }

        // Remove paths that are no longer watched
        for(let pathHash of Object.keys(prevPaths)) {
            if(pathHash in paths) continue;
            if(!pathsWatched[pathHash]) continue;
            delete pathsWatched[pathHash].callbacks[pathHash];
            if(isEmpty(pathsWatched[pathHash].callbacks)) {
                delete pathsWatched[pathHash]
            }
            delete prevPaths[pathHash];
        }
    }
}