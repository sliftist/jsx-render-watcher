import * as preact from "preact";
import { observable, ObservableRawValue } from "./observable";
import { getAccesses } from "./getAccesses";
import { observer } from "./observer";

/*
let x = observable({
    y: 5,
    z: 2,
});

let observedFunction = observer(() => {
    let sum = 0;
    for(let key in x) {
        sum += (x as any)[key];
    }
    return { sum };
});

let updateHolder = {
    forceUpdate() {
        console.log("forceUpdate");
        console.log(observedFunction.call(updateHolder).sum);
    }
};

console.log(observedFunction.call(updateHolder).sum);

(async () => {
    await Promise.resolve();
    x.z = 3;
    await Promise.resolve();
    (x as any).k = 1;
})();
*/

// Force observer to get included
observer(() => {});


let wtf = observable({x: 5});

//todonext;
// Okay... the problem is that setState wipes out the state object, which means new properties on it
//  no longer become observables.
// Oh right, I was planning on doing something with the this context...
//  Uh... okay... I could make it so everything accessed inside of the this context gets turned into
//  an observable, AS it is accessed?
//  - Hmm... this is nice, because if setState is called, it wipes out the root observable, but
//      render gets called anyway!
//  - I think the only downside... is if the state is directly passed to another component?
//  - I'm trying to think... is there a case where this would keep remaking an observable for the same
//      path, because of setState wiping it out? I don't think there is... the observable tree will
//      still virtually exist, and just be reused...
//      - One case could be if state is used as a lookup, and setState is called to remove values.
//          We won't know they are deleted (as we don't check, we just wait for deleteProperty), so...
//          that would cause a memory leak...

export class TestMain extends preact.Component<{}, {}> {
    state = {
        x: 0
    };

    componentDidMount() {
        setInterval(() => {
            this.state.x++;
        }, 1000);
    }

    public render = (() => {
        //todonext;
        // Works with preact (maybe), now... test this with react.
        //  Then get the debugging utilities working, so we are sure we know what is going on.
        let thisObservable = observable(this, undefined, true);
        return observer(function(this: TestMain) {
            return <div>test {+thisObservable.state.x}</div>;
        });
    })();
}