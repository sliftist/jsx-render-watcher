import * as preact from "preact";
import { eye, EyeRawValue, EyeLevel } from "./eye";
import { getAccesses } from "./getAccesses";
import { watcher } from "./watcher";

/*
let x = eye({
    y: 5,
    z: 2,
});

let observedFunction = watcher(() => {
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

// Force watcher to get included
watcher(() => {});

class Test {
    #test = 5;
}

export class TestMain extends preact.Component<{ y: number }, {}> {
    state = {
        x: 0,
        lookup: {} as { [key: number]: true }
    };

    test = eye({ y: 5 });

    componentDidMount() {
        setInterval(() => {
            this.state.x++;
            (this as any).props.y++;
            this.test.y++;
            this.state.lookup[Date.now()] = true;
        }, 1000);
    }

    public render = watcher(function(this: TestMain) {
        return <div>test {this.state.x}, {this.props.y}, {this.test.y}, {Object.keys(this.state.lookup).length}</div>;
    }, EyeLevel.eye3_replace);
}