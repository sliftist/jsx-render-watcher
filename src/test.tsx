import * as preact from "preact";
import { eye, EyeRawValue, EyeLevel } from "./eye";
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
//      - We probably want to use some sort of subscribe system... and hook it up to our dispose, ugh... and have the watcher maintain
//          it an unsubscribe if we stop using a delta... that way objects don't need to hold their delta history indefinitely.
//          - Hmm... maybe we could do it via... batching our Promise.resolve calls, so that we are always asking for the last delta,
//              which gets reset after our call batch? We could need... to capture and save the delta if we plan on delaying evaluation of
//              something for behind one tick, but... that would be fine...
//              - AND this approach would all further debugging of our changes. As in, how many callbacks there are per tick, and who
//                  asked for the callbacks. We could even potentially... put in logic to allow callbacks to be split into 2 steps,
//                  one immediate that stores the data, and one that does the work. AND we could then allow the one that does the work
//                  to be delayed and then folded on top of ones with the same id... allowing us to delay and then batch changes, allowing
//                  prioritization... which is NICE.
//  - The watchers returning deltas will be simpler, they only need to return the current delta.

export class TestMain extends preact.Component<{ y: number }, {}> {
    state = {
        x: 0,
        lookup: {} as { [key: number]: true }
    };

    test = eye({ y: 5 });

    componentDidMount() {
        setTimeout(() => {
            this.state.x++;
        }, 0);
        /*
        setInterval(() => {
            this.state.x++;
            (this as any).props.y++;
            this.test.y++;
            this.state.lookup[Date.now()] = true;
        }, 1000);
        */
    }

    public render = derivedRaw(function(this: TestMain) {
        return <div>test {this.state.x}, {this.props.y}, {this.test.y}, {Object.keys(this.state.lookup).length}</div>;
    }, "TestMain.render", EyeLevel.eye3_replace);
}


(async () => {
    await launchDebugUtils();
    let obj = eye({ x: 0 });
    derived(() => {
        return obj.x;
    }, undefined, "derivedTest");
})();