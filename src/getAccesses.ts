import { EyeMark, EyeType, EyePath } from "./eye";
import { watchAccesses, getReads } from "./accessEvents";
import { insertIntoListMapped, compareString, isEmpty, binarySearchMapped } from "./lib/algorithms";
import { getParentHash, rootPath, pathFromArray, p2 } from "./lib/path";
import { g } from "./lib/misc";

import { exposeDebugLookup } from "./debugUtils/exposeDebug";
import { getPathQuery } from "./debugUtils/searcher";

// NOTE: At the end of the day, this requires a code() callback, instead of "startWatch" and "endWatch" functions, simply
//      for performance reasons. Keeping track of changes takes memory, and so we don't want to keep track of changes
//      indefinitely. If we exposed a "startWatch" function and the "endWatch" wasn't called, we would have to keep track of
//      changes in perpetuity, which will explicitly be a memory leak.


export type AccessState = {
    reads: Map<string, { path: EyeTypes.Path2 }>;
    keyReads: Map<string, { path: EyeTypes.Path2 }>;
};



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



exposeDebugLookup("eyePathsWatched", eyePathsWatched, x => eyePathsWatched = x, [
    { query: getPathQuery([{ query: "" }]), type: "lookup" },
    { query: getPathQuery([{ query: "" }, { query: "" }]), type: "lookup", foreignKey: { lookupName: "pathsWatched", useObjectKey: true } },
]);
exposeDebugLookup("pathsWatched", pathsWatched, x => pathsWatched = x, [
    { query: getPathQuery([{ query: "" }]), hideColumn: true },
    { query: getPathQuery([{ query: "" }, "path"]), formatValue: ((value: EyeTypes.Path2) => value.path) as any },
    //{ query: rootPath },
    //{ query: p2("path"), formatValue: ((value: EyeTypes.Path2) => value.path.join(".")) as any },
    //{ query: p2("callbacks"), type: "lookup" },
    //{ path: pathFromArray(["callbacks", PathWildCardKey]), formatValue: (value) => String(value).slice(0, 100) },
]);

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
    pathsObj: AccessState,
    callback: (path: EyeTypes.Path2) => void,
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
            pathsWatched[pathHash] = pathsWatched[pathHash] || { path, callbacks: Object.create(null) };
            pathsWatched[pathHash].callbacks[pathHash] = { callback };
            prevPaths[pathHash] = true;
        }

        // Remove paths that are no longer watched
        for(let pathHash of Object.keys(prevPaths)) {
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
    added: Map<string, { path: EyeTypes.Path2 }>;
    removed: Map<string, { path: EyeTypes.Path2 }>;
}

export function watchPathsDelta(
    pathsDelta: {
        reads: PathDelta;
        keyReads: PathDelta;
    },
    callback: (path: EyeTypes.Path2) => void,
    accessId: string,
): void {
    let pathHash = accessId;

    subscribe(pathsDelta.reads, pathsWatched, eyePathsWatched);
    subscribe(pathsDelta.keyReads, keysPathsWatched, keysEyePathsWatched);

    function subscribe(
        paths: PathDelta,
        pathsWatched: PathsWatched,
        eyePathsWatched: WatcherPaths
    ) {
        eyePathsWatched[pathHash] = eyePathsWatched[pathHash] || Object.create(null);
        let prevPaths = eyePathsWatched[pathHash];

        // Add paths that are watched
        for(let [pathHash, path] of paths.added) {
            pathsWatched[pathHash] = pathsWatched[pathHash] || { path, callbacks: Object.create(null) };
            pathsWatched[pathHash].callbacks[pathHash] = { callback };
            prevPaths[pathHash] = true;
        }

        // Remove paths that are no longer watched
        for(let [pathHash] of paths.removed) {
            delete pathsWatched[pathHash].callbacks[pathHash];
            if(isEmpty(pathsWatched[pathHash].callbacks)) {
                delete pathsWatched[pathHash]
            }
            delete prevPaths[pathHash];
        }
    }
}