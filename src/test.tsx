import * as preact from "preact";
import { eye, EyeRawValue, EyeLevel, eye0_pure } from "./eye";
import { getAccesses } from "./getAccesses";
import { derivedRaw, derived } from "./watcher";
import { g } from "./misc";
import { launchDebugUtils } from "./debugUtils/exposeDebug";



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
})();