import * as preact from "preact";

import { getAccesses } from "../getAccesses";
import { g } from "../misc";
import { eye0_pure, EyeLevel } from "../eye";
import { derivedRaw } from "../watcher";
import { exposedLookups } from "./exposeDebug";

//todonext;
// So... we need a generic list/lookup watch syntax? Ugh... with indexes, dynamically created
//  by mapper functions?
// Plus mapper functions to automatically join lists, so you can open sub tables which are
//  the intersections between the tables (literally, a SQL join, not even objects).
// FUCK, so a DB in javascript. Uh... whatever... probably be only like 300 lines...
// And, uh... time as a possibly dynamic property, so we can sort it into a change log?
// So... we are notified on key creation, deletion, and object changing. Then we copy the entire
//  contents of the object (that we care about), into our own state.
//  - Then... we make indexes, to this objects, that have keys that are like: type + key, type + value.x,
//      with the values being the copied object.
//todonext;
// So... how can we make the root watcher interface... use eyes...
//  AND, do we need to do anything special to make it work across windows? I'm assuming the static variables
//  and stuff will be different, which is actually useful, but otherwise... is anything else needed?
//  - Maybe... the debug utils window should give an eye constructor to the parent window... and then
//      at least some of the objects we use to manage watches can be wrapped with eyes?
// OH! And it can be done after load, we can wrap the root lookups getAccesses uses after load,
//      so... that should make things easier!


// TODO:
//  - table of watchers
//      - key of watcher
//      - number of eyes watched
//      - expand for sub table of eyes (which is also filterable, etc)
//  - filtering/searching of tables
//  - table of eyes
//  - expensive instrumentation via a filter, which uses new Error() to get more information
//  - sub table for eyes that gives list of changes in eye (recursively?)
//      - with expensive instrumentation giving line information of source of changes
//  - sub table for watcher, which gives list of watched eyes
//      - with expensive instrumentation giving line information of source of watches
//  - sub table for eyes that gives list of watchers by eye
export class DebugUtils extends preact.Component<{}, {}> {
    public render = derivedRaw(function(this: DebugUtils) {
        
        let lookup = exposedLookups["eyePathsWatched"] && exposedLookups["eyePathsWatched"].eyeLookup;

        return (
            <div>
                <div>debug utils</div>
                <div>
                    {JSON.stringify(Object.keys(exposedLookups))}
                </div>
                <div>
                    {lookup && (
                        <div>
                            eyes:
                            <div>
                                {Object.keys(lookup).map(eyeKey => {
                                    return (
                                        <div>{eyeKey}</div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }, "DebugUtils.render", EyeLevel.eye3_replace);
}

/*
getAccesses;
let watchedWindow = window.opener as typeof window;
(async () => {
    while(!watchedWindow.__eye_pathsWatched) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    watchedWindow.__eye_pathsWatched = eye0_pure(watchedWindow.__eye_pathsWatched);
})();
*/