import * as preact from "preact";
import * as React from "react";
import { eye, EyeRawValue, EyeLevel, eye0_pure, GetUniqueRootPath, EyePath, EyeType } from "./eye";
import { derivedRaw, derived, derivedTriggerDiag } from "./derived";
import { g } from "./lib/misc";
import { launchDebugUtils } from "./debugUtils/exposeDebug";
import { DeltaContext, DeltaStateId, DeltaState, GetCurLookupDelta } from "./delta";
import { getRootKey, getChildPath } from "./lib/path";
import { registerOwnKeysWrite, registerKeysReadAccess, registerReadAccess, registerWrite, registerDeltaReadAccess } from "./accessEvents";

import { ThrowIfNotImplementsData } from "pchannel";

import { render } from "preact-render-to-string";
import { MountVanillaComponents } from "./mount2Vanilla";
import { ComponentInstanceClass } from "./mount2";




//todonext;
// Uh... screw it, this MAY work in React, it may not.
//  Instead of worrying about that... let's get... ugh... I guess debug utils.
//  But just a BIT of debug utils, and then... efficient object updates to watchers,
//      and then... we can stick in our own renderer, and do list updates efficient?
//      - And then, we can try to get some support for efficient list updating in preact? It should be fairly easy,
//          at at least we can just fork preact or something... because all it needs to do it compare the object against the previous
//          one, and if they ===, and have a special symbol... then it can use that instead of mounting the entire object...

//todonext;
// So... in watcher, the "makeOutputEye" option, will have to understand object deltas, and apply the changes as deltas to the eye.
//  And then... eyes will need to expose object deltas to anyone who wants them, so the watchers can ingest deltas.
//  - The eyes exposing object deltas will require some form of SeqNum history... unfortunately...
//      - Hmm... maybe we could do it via... batching our Promise.resolve calls, so that we are always asking for the last delta,
//          which gets reset after our call batch? We could need... to capture and save the delta if we plan on delaying evaluation of
//          something for behind one tick, but... that would be fine...
//          - AND this approach would all further debugging of our changes. As in, how many callbacks there are per tick, and who
//              asked for the callbacks. We could even potentially... put in logic to allow callbacks to be split into 2 steps,
//              one immediate that stores the data, and one that does the work. AND we could then allow the one that does the work
//              to be delayed and then folded on top of ones with the same id... allowing us to delay and then batch changes, allowing
//              prioritization... which is NICE.
//      - EXCEPT what about synchronous triggers?
//          - As in, the delta changes, we batch something to handle it, then start handling it (and at the end of the batch remove the delta),
///             BUT, another handler of the changes modifies the delta. This modification has to stick around until the end of the NEXT
//              batch, which... is tricky...
//      - Okay... we could make getDelta pair with a clearDelta, so it is destructive. And then... with our own changes we will just have to
//          cache the delta, and/or clear it intelligently.
//      - Ugh... okay:
//          - new DeltaWatch
//          - .watch(code)
//          - .dispose
//          - And then on delta-like objects, .getNextDelta(deltaWatch)
//          - And if a watch finishes without a delta being accessed, then that delta is no longer tracked
//              - So dispose is just .watch(() => {})
//                  - Maybe dispose should be called .clear...
//          - Oh, so... maybe we should automatically pass deltaWatch, and then just... have a default state where getNextDelta
//              clears immediately after being called.
//      - But for preact, we will have to just expose a .getNextDelta() function...
//  - The watchers returning deltas will be simpler, they only need to return the current delta.

type TodoListType = {
    listName: string;
    entries: {
        text: string;
        timeAdded: number;
        timeLastModified: number;
    }[];
    pendingAdd: string;
};

export class TodoList extends preact.Component<{list: TodoListType}, {}> {
    private addPending() {
        let { list } = this.props;
        if(!list.pendingAdd) return;
        let time = Date.now();
        list.entries.push({
            text: list.pendingAdd,
            timeAdded: time,
            timeLastModified: time,
        });
        list.pendingAdd = "";
    }

    public render = derivedRaw(function(this: TodoList) {
        let { list } = this.props;
        return (
            <div>
                <div>List: {list.listName}</div>
                <div>
                    {list.entries.map((entry, index) => (
                        <div>
                            <input
                                value={entry.text}
                                onInput={x => entry.text = x.currentTarget.value}
                                onKeyDown={e => { if(e.key === "Enter") e.currentTarget.blur(); }}
                                onBlur={() => {
                                    if(entry.text === "") {
                                        list.entries.splice(index, 1);
                                    }
                                }}
                            />
                        </div>
                    ))}
                </div>
                <div>
                    <input
                        value={list.pendingAdd}
                        onInput={x => list.pendingAdd = x.currentTarget.value}
                        onKeyDown={e => { if(e.key === "Enter") e.currentTarget.blur(); }}
                        onBlur={x => {
                            this.addPending();
                        }}
                    />
                </div>
            </div>
        );
    }, { niceName: "TodoList.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}

export class TestMain extends preact.Component<{ y: number }, {}> {
    state = {
        x: 0,
        lookup: {} as { [key: number]: true }
    };

    data: {
        [listName: string]: TodoListType
    } = Object.assign(Object.create(null), {
        ["pendingList"]: {
            listName: "pendingList",
            entries: [],
        }
    });

    test = eye({ y: 5 });

    componentWillMount() {
        let todolistJSON = localStorage.getItem("todolist");
        if(todolistJSON) {
            try {
                this.data = JSON.parse(todolistJSON);
            } catch(e) {
                console.log(`Error loading todolist from localStorage`);
            }
        }
    }

    componentDidMount() {
        // If we do deriveds in our didMount, it will be after our first render, and so all of the data
        //  accessed in render will have be eye-ified, making this derived work. Otherwise we will be accessing
        //  raw values, which won't generate any subscriptions.
        derived(() => {
            let dataJSON = JSON.stringify(this.data);
            localStorage.setItem("todolist", dataJSON);
        }, "dataToLocalStorage", undefined, { singleton: true });
    }

    public render = derivedRaw(function(this: TestMain) {
        return (
            <div>
                {Object.keys(this.data).map(listName => {
                    let list = this.data[listName];
                    list.listName;
                    return <TodoList list={list} />
                })}
            </div>
        );
    }, { niceName: "TestMain.render", thisContextEyeLevel: EyeLevel.eye3_replace });
}


/*
(async () => {
    await launchDebugUtils();
    let obj = eye({ x: 0 });

    derived(() => {
        obj.x;
        return Object.keys(obj);
    }, "derivedTest");

    derived(() => {
        obj.x;
        return Object.keys(obj);
    }, "derivedTest2");


    {
        let lookupRaw: { [key: string]: number } = Object.create(null);

    }
})();
*/



(async () => {
    let deltaId: DeltaStateId<OurDeltaState> = {
        startRun(state) {
            if(state.curDelta) throw new Error(`Internal error, startRun called before finishRun called`);
            state.curDelta = state.pendingDelta;
            state.pendingDelta = {
                firstDelta: false,
                changes: Object.create(null),
            };
        },
        finishRun(state) {
            state.curDelta = undefined;
        }
    };

    let statePath = GetUniqueRootPath("stateTest");
    let state: { [key: string]: number } = Object.create(null);
    function triggerChange(key: string) {
        let states = DeltaContext.GetAllStates(deltaId) as OurDeltaState[];
        for(let deltaState of states) {
            let { curDelta, pendingDelta } = deltaState;
            applyChange(pendingDelta);
            if(curDelta) applyChange(curDelta);
            function applyChange(delta: Delta) {
                if(!(key in delta.changes)) {
                    delta.changes[key] = {
                        prevValue: key in state ? state[key] : undefined
                    };
                }
            }
        }
    }
    function addChangeState(key: string, value: number) {
        if(!(key in state)) {
            registerOwnKeysWrite(statePath, key, "add");
        }
        if(state[key] !== value) {
            registerWrite(getChildPath(statePath, key));
        }
        triggerChange(key);
        state[key] = value;
    }
    function removeState(key: string) {
        if(key in state) {
            registerOwnKeysWrite(statePath, key, "remove");
            registerWrite(getChildPath(statePath, key));
        }
        triggerChange(key);
        delete state[key];
    }

    interface Delta {
        firstDelta: boolean;
        changes: {
            [key: string]: {
                prevValue: number|undefined;
            }
        }
    }
    interface OurDeltaState extends DeltaState {
        pendingDelta: Delta;
        curDelta: Delta|undefined;
    };
    function getDefaultDelta(): OurDeltaState {
        return {
            pendingDelta: {
                firstDelta: true,
                changes: Object.create(null),
            },
            curDelta: undefined,
        };
    }

    function getDelta(): {
        fullState: { [key: string]: number };
        changes: Delta["changes"]
    } {
        registerKeysReadAccess(statePath);

        // registerDeltaReadAccess
        let deltaContext = DeltaContext.GetCurrent();
        if(deltaContext) {
            let deltaState = deltaContext.GetOrAddState(deltaId, getDefaultDelta);
            let { curDelta } = deltaState;
            if(!curDelta) throw new Error(`Internal error, should be in current delta`);

            if(!curDelta.firstDelta) {
                return {
                    fullState: state,
                    changes: curDelta.changes,
                }
            }
        }

        let prevValues: Delta["changes"] = Object.create(null);
        for(let key in state) {
            prevValues[key] = { prevValue: undefined };
        }

        return {
            fullState: state,
            changes: prevValues,
        };
    }

    addChangeState("a", 1);
    addChangeState("b", 2);
    /*
    fullReads: Map<string, EyeTypes.Path2>;
    readsAdded: EyeTypes.Path2[];
    readsRemoved: EyeTypes.Path2[];
    registerDeltaReadAccess()
    */

    let lastSumLoopCount = 0;
    function createSumer() {
        interface SumerDeltaState extends DeltaState {
            sum: number;
            fullReads: Map<string, { path: EyeTypes.Path2 }>;
        }
        let deltaId: DeltaStateId<SumerDeltaState> = { };

        return function () {
            let sum = 0;
            let deltaContext = DeltaContext.GetCurrent();
            let deltaState = deltaContext?.GetOrAddState(deltaId, () => ({ sum: 0, fullReads: new Map() } as SumerDeltaState));
            if(deltaState) {
                sum = deltaState.sum;
            }

            let { fullState, changes } = getDelta();

            if(deltaState) {
                let readsAdded: Map<string, EyeTypes.Path2> = new Map();
                let readsRemoved: Map<string, EyeTypes.Path2> = new Map();
                for(let key in changes) {
                    if(key in state) {
                        let path = getChildPath(statePath, key);
                        if(!deltaState.fullReads.has(path.pathHash)) {
                            deltaState.fullReads.set(path.pathHash, {path});
                            readsAdded.set(path.pathHash, path);
                        }
                    } else {
                        let path = getChildPath(statePath, key);
                        if(deltaState.fullReads.has(path.pathHash)) {
                            deltaState.fullReads.delete(path.pathHash);
                            readsRemoved.set(path.pathHash, path);
                        }
                    }
                }
                registerDeltaReadAccess({
                    fullReads: deltaState.fullReads,
                    readsAdded,
                    readsRemoved,
                });
            } else {
                for(let key in changes) {
                    if(key in state) {
                        registerReadAccess(getChildPath(statePath, key));
                    }
                }
            }
            
            
            lastSumLoopCount = 0;
            for(let key in changes) {
                let { prevValue } = changes[key];
                if(prevValue !== undefined) {
                    sum -= prevValue;
                }
                if(key in fullState) {
                    sum += fullState[key];
                }
                lastSumLoopCount++;
            }

            if(deltaState) {
                deltaState.sum = sum;
            }

            return sum;
        };
    }

    let context = new DeltaContext(createSumer());

    console.warn(`Start explicit test`);

    for(let i = 0; i < 100; i++) {
        addChangeState("v" + i, 0);
    }

    ThrowIfNotImplementsData(context.RunCode(), 3);

    addChangeState("c", 1);
    ThrowIfNotImplementsData(context.RunCode(), 4);

    removeState("a");
    ThrowIfNotImplementsData(context.RunCode(), 3);

    addChangeState("c", 10);
    ThrowIfNotImplementsData(context.RunCode(), 12);
    console.warn(`End explicit test`);



    {
        console.warn(`Start derived test`);
        let sumer = createSumer();
        let lastSum = 0;
        let eyeDerived = derived(function () {
            lastSum = sumer();
        }) as EyeType<void>;
        let eyePath = eyeDerived[EyePath];
        ThrowIfNotImplementsData(lastSum, 12);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);

        addChangeState("c", 1);
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 3);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);

        removeState("c");
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 2);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);

        addChangeState("d", 5);
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 7);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);

        console.warn(`end derived test`);
    }

    {
        console.warn(`Start eye test`);


        let rawState: { [key: string]: number } = Object.create(null);
        let state = eye0_pure(rawState);
        state["a"] = 1;
        state["b"] = 2;
        for(let i = 0; i < 100; i++) {
            state["v" + i] = 0;
        }

        let lastSum = 0;
        let eyeDerived = derived(function (this: any) {
            lastSumLoopCount = 0;
            let changes = GetCurLookupDelta(state);
            for(let { prevValue, newValue } of changes.values()) {
                lastSumLoopCount++;
                lastSum -= prevValue || 0;
                lastSum += newValue || 0;
            }
        }) as EyeType<void>;

        

        let eyePath = eyeDerived[EyePath];
        ThrowIfNotImplementsData(lastSum, 3);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);

        state["c"] = 1;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 4);

        delete state["c"];
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 3);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);


        state["d"] = 5;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 8);
        console.log(`Took loops ${lastSumLoopCount}, last watched reads ${derivedTriggerDiag[eyePath.pathHash].lastWatchedReads}`);


        console.warn(`end eye test`);
    }

    {
        let node = document.createElement("div");

        MountVanillaComponents(
            <div>test</div>,
            node,
            false
        );

        console.log(node.innerHTML);

        //let y = <Test />;
        //console.log(y);
        //debugger;
        //todonext;
        // Now... we need to write our own dom mounter, that is somewhat delta aware (maybe not of GetCurLookupDelta,
        //  but perhaps using something that only uses modifications to JSX, although... just using a symbol that returns
        //  the delta... is probably fine. Although we would hardcode the delta in the JSX object? That way it doesn't
        //  have to use DeltaContext?
        //  - Or... we COULD use DeltaContext, idk, something like that.
        // And also, we already wrote a dom mounter, so just take a lot of the code from that...
    }
})();



// Okay, delta getAccesses. This requires nested getAccesses calls, that instead of isolating
//  children, just gather them up so they can be efficiently combined in the parent.
//  - And we will also need an unregisterDeltaReadAccess function
// AND THEN! Implement global manual deriveds, that explicitly know about getting deltas,
//  and store their previous state globally.
//  - Actually, we can start by just explicitly tracking the delta manually...




//todonext;
// OH! So... a lot of derived functions will actually need to have their context
//  based on the parts they depend on. Like, a map of a delta array depends on the
//  delta array, the function passed to map (maybe just the .toString of it?), and the
//  operation (map).
//  - So... this means we really want to pull our maps inside of render functions and make
//      global deriveds, as there should really be... but then be smart about destructing the
//      global deriveds, if the render functions stop using them.
// WHICH... means we need the context to be a list of objects, not just one... Crap...
//  - Ugh... I GUESS we can create a WeakMap for each object, to map it to a UID, and then
//      we can use that?


//todonext;
// We should have a globally available delta context thing. This will allow objects to store their state,
//  and then at any time access their previous state. And also they can use it to store global changes
//  in that context.
//  - OH! And, it can use a WeakMap, with an object key, so when the context doesn't exist,
//      everything that was using it can go away (so we'll have to never close upon the context?, or... something...)
// The starting candidate should be our todolist, in which changing rerendering because of a change in one item
//  should only result in a few reads, not reading of all the todolist items.
// So... eye will need to have a "getDelta" function, uh... I guess it will have to be a symbol...
//  And then we will have to add that symbol also to the ownKeys array result.
//  And replace the ownKeys map function, so it knows about the delta, using the state to efficiently
//      generate a new array.
//  And of course getAccesses will have to aware of this, in general. Everything that uses delta instead
//      of the full values will have to... have a nested getAccesses? And then getAccesses will have to store
//      reads for each delta independent of the global accesses, and then in its subscribe function it will
//      have to... keep track of which deltas are causing each read, then only apply the deltas, and then
//      it can know what finally isn't read anymore. 