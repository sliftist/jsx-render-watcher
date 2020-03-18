import { ObservableMark, ObservableType, ObservablePath } from "./observable";
import { watchAccesses } from "./accessEvents";
import { insertIntoListMapped, compareString, isEmpty, binarySearchMapped } from "./algorithms";
import { getParentHash } from "./path";

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
    reads: { [pathHash: string]: Observ.Path2 };
    keyReads: { [pathHash: string]: Observ.Path2 };
    writes: { [pathHash: string]: Observ.Path2 };
};

/** Runs code, and returns the
 * 
 * @param observableOutput IF observableOutput is passed then accesses inside of code won't trigger accesses inside
 *      of wrapper getAccesses calls. However we will ensure observableOutput is accesses, and if it isn't
 *      we will throw an exception.
 *      - This parameter is used to allow "collapsing" of dependencies via "computed" type functions. In which case depending
 *          on the computed's dependencies (on your dependency's dependencies) is redundant.
*/
export function getAccesses(
    code: () => void,
    observableOutput?: { [ObservableMark]: true }
): DeepReadonly<AccessState> {
    let accesses: AccessState = {
        reads: Object.create(null),
        keyReads: Object.create(null),
        writes: Object.create(null),
    };
    let { unwatch } = watchAccesses({
        read(path) {
            accesses.reads[path.pathHash] = path;
        },
        readKeys(path) {
            accesses.keyReads[path.pathHash] = path;
        },
        write(path) {
            accesses.writes[path.pathHash] = path;
        },
    })
    try {
        code();
    } finally {
        unwatch();
    }
    return accesses;
}

// TODO: Expose (to some kind of debug utility) the information of which observer is triggering which observer (we know if we are an observer,
//  because it will be within a getAccesses call). Of course it may be from a raw location, in which case getting the location information
//  (via new Error()) is more expensive, but we should support it in some way.
type PathsWatched = {
    path: Observ.Path2;
    callbacks: {
        [observableOutputPathHash: string]: {
            callback: (path: Observ.Path2) => void
        }
    };
}[];
type ObservablePathsWatched = {
    [observableOutputPathHash: string]: {
        [pathHash: string]: true
    }
};

let pathsWatched: PathsWatched = [];
let observablePathsWatched: ObservablePathsWatched = Object.create(null);

let keysPathsWatched: PathsWatched = [];
let keysObservablePathsWatched: ObservablePathsWatched = Object.create(null);

watchAccesses({
    read(path) {
        console.log("read", path);
    },
    readKeys(path) {
        console.log("read keys", path);
    },
    write(path) {
        console.log("write", path);

        // Trigger any watchs on this path, or on any children
        trigger(path.pathHash, pathsWatched);
        trigger(getParentHash(path.pathHash), keysPathsWatched);
        function trigger(pathHash: string, pathsWatched: PathsWatched) {
            let index = binarySearchMapped(pathsWatched, pathHash, x => x.path.pathHash, compareString);
            if(index < 0) index = ~index;
            let startIndex = index;
            while(index < pathsWatched.length && pathsWatched[index].path.pathHash.startsWith(pathHash)) {
                index++;
            }
            let endIndex = index;
            let callbacksTriggered = pathsWatched.slice(startIndex, endIndex).map(x => x.callbacks);
            for(let callbackLookup of callbacksTriggered) {
                for(let key in callbackLookup) {
                    callbackLookup[key].callback(path);
                }
            }
        }
    },
});

export function unwatchPaths(observableOutput: ObservableType<unknown>) {
    watchPaths({ keyReads: Object.create(null), reads: Object.create(null) }, () => {}, observableOutput);
}

/** Calls callback whenever any of the read paths OR their parents are changed.
 *      Will replace any existing callbacks on observableOutput. If paths is empty, just removes all callbacks.
*/
export function watchPaths(
    pathsObj: Omit<AccessState, "writes">,
    callback: (path: Observ.Path2) => void,
    observableOutput: ObservableType<unknown>,
): void {
    let pathHash = observableOutput[ObservablePath].pathHash;

    subscribe(pathsObj.reads, pathsWatched, observablePathsWatched);
    subscribe(pathsObj.keyReads, keysPathsWatched, keysObservablePathsWatched);

    function subscribe(paths: AccessState["keyReads"]|AccessState["reads"], pathsWatched: PathsWatched, observablePathsWatched: ObservablePathsWatched) {
        observablePathsWatched[pathHash] = observablePathsWatched[pathHash] || Object.create(null);
        let prevPaths = observablePathsWatched[pathHash];

        // Add paths that are watched
        for(let key in paths) {
            let path = paths[key];
            let index = insertIntoListMapped(pathsWatched, { path, callbacks: Object.create(null) }, x => x.path.pathHash, compareString, "ignore");
            pathsWatched[index].callbacks[pathHash] = { callback };
            prevPaths[key] = true;
        }

        // Remove paths that are no longer watched
        for(let key of Object.keys(prevPaths)) {
            if(!(key in paths)) {
                let index = binarySearchMapped(pathsWatched, key, x => x.path.pathHash, compareString);
                if(index >= 0) {
                    delete pathsWatched[index].callbacks[pathHash];
                    if(isEmpty(pathsWatched[index].callbacks)) {
                        pathsWatched.splice(index, 1);
                    }
                }
                delete prevPaths[key];
            }
        }
    }
}