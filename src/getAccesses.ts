import { EyeLevelMark, EyeType } from "./eye";
import { watchAccesses, getReads } from "./accessEvents";
import { insertIntoListMapped, compareString, isEmpty, binarySearchMapped } from "./lib/algorithms";
import { getParentHash, rootPath, pathFromArray, p2 } from "./lib/path";
import { g } from "./lib/misc";

import { exposeDebugLookup } from "./debugUtils/exposeDebug";
import { getPathQuery } from "./debugUtils/searcher";
import { derivedTotalReads } from "./derived";

// NOTE: At the end of the day, this requires a code() callback, instead of "startWatch" and "endWatch" functions, simply
//      for performance reasons. Keeping track of changes takes memory, and so we don't want to keep track of changes
//      indefinitely. If we exposed a "startWatch" function and the "endWatch" wasn't called, we would have to keep track of
//      changes in perpetuity, which will explicitly be a memory leak.


export type AccessState = {
    reads: Set<string>;
    keyReads: Set<string>;
};



// TODO: Expose (to some kind of debug utility) the information of which watcher is triggering which watcher (we know if we are an watcher,
//  because it will be within a getAccesses call). Of course it may be from a raw location, in which case getting the location information
//  (via new Error()) is more expensive, but we should support it in some way.


type PathsWatched = {
    [pathHash: string]: {
        callbacks: {
            [eyeOutputPathHash: string]: {
                callback: (pathHash: string) => void
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
exposeDebugLookup("pathsWatched", pathsWatched, x => pathsWatched = x);

function trigger(pathHash: string, pathsWatched: PathsWatched) {
    let callbacksObj = pathsWatched[pathHash];
    if(!callbacksObj) return;

    let { callbacks } = callbacksObj;
    for(let callback of Object.values(callbacks).map(x => x.callback)) {
        callback(pathHash);
    }
}

watchAccesses({
    write(path) {
        console.log("write", path);
        trigger(path, pathsWatched);
    },
    writeKey(parentPath) {
        console.log("change key in object", parentPath);
        trigger(parentPath, keysPathsWatched);
    }
});

export function unwatchPaths(accessId: string) {
    let noWatches: AccessState = {
        keyReads: new Set(),
        reads: new Set(),
    };
    watchPaths(noWatches, () => {}, accessId);
}

/** Calls callback whenever any of the read paths OR their parents are changed.
 *      Will replace any existing callbacks on eyeOutput. If paths is empty, just removes all callbacks.
*/
export function watchPaths(
    pathsObj: AccessState,
    callback: (pathHash: string) => void,
    accessId: string,
): void {
    let pathHash = accessId;

    subscribe(pathsObj.reads, pathsWatched, eyePathsWatched);
    subscribe(pathsObj.keyReads, keysPathsWatched, keysEyePathsWatched);

    function subscribe(
        paths: AccessState["keyReads"]|AccessState["reads"],
        pathsWatched: PathsWatched,
        eyePathsWatched: WatcherPaths
    ) {
        eyePathsWatched[pathHash] = eyePathsWatched[pathHash] || Object.create(null);
        let prevPaths = eyePathsWatched[pathHash];

        // Add paths that are watched
        for(let [pathHash, path] of paths) {
            derivedTotalReads.value++;
            pathsWatched[pathHash] = pathsWatched[pathHash] || { path, callbacks: Object.create(null) };
            pathsWatched[pathHash].callbacks[pathHash] = { callback };
            prevPaths[pathHash] = true;
        }

        // Remove paths that are no longer watched
        for(let pathHash of Object.keys(prevPaths)) {
            derivedTotalReads.value++;
            if(paths.has(pathHash)) continue;
            if(!pathsWatched[pathHash]) continue;
            delete pathsWatched[pathHash].callbacks[pathHash];
            if(isEmpty(pathsWatched[pathHash].callbacks)) {
                delete pathsWatched[pathHash]
            }
            delete prevPaths[pathHash];
        }
    }
}

/*
reads: { [pathHash: string]: EyeTypes.Path2 };
keyReads: { [pathHash: string]: EyeTypes.Path2 };
*/

export interface PathDelta {
    added: Set<string>;
    removed: Set<string>;
}

export function watchPathsDelta(
    pathsDelta: {
        reads: PathDelta;
        keyReads: PathDelta;
    },
    callback: (pathHash: string) => void,
    accessId: string,
): void {

    subscribe(pathsDelta.reads, pathsWatched, eyePathsWatched);
    subscribe(pathsDelta.keyReads, keysPathsWatched, keysEyePathsWatched);

    function subscribe(
        paths: PathDelta,
        pathsWatched: PathsWatched,
        eyePathsWatched: WatcherPaths
    ) {
        eyePathsWatched[accessId] = eyePathsWatched[accessId] || Object.create(null);
        let prevPaths = eyePathsWatched[accessId];

        // Add paths that are watched
        for(let pathHash of paths.added) {
            derivedTotalReads.value++;
            pathsWatched[pathHash] = pathsWatched[pathHash] || { callbacks: Object.create(null) };
            pathsWatched[pathHash].callbacks[accessId] = { callback };
            prevPaths[pathHash] = true;
        }

        // Remove paths that are no longer watched
        for(let pathHash of paths.removed) {
            derivedTotalReads.value++;
            delete pathsWatched[pathHash].callbacks[accessId];
            if(isEmpty(pathsWatched[pathHash].callbacks)) {
                delete pathsWatched[pathHash];
            }
            delete prevPaths[pathHash];
        }
    }
}