import { eye0_pure, eye } from "./eye";
import { derivedTotalReads } from "./derivedStats";
import { derived, settleDerivedsNow } from "./derived";
import { deltaArrayMap } from "./delta/deltaMap";
import { ThrowIfNotImplementsData } from "pchannel";

//todonext;
// This needs to be more efficient. We might need group key sets, so we can set everything in an array at once,
//  and only incur 1 operation. It... shouldn't be so hard, we can dynamically decide which we want to make
//  inside the derived call, based on how many are being set...
//  - Hmm... so if we create a generic x.* path... that would be ideal. It might trigger too many changes, but... hmm...
//      - I guess we want the watcher to use x.*, and then we can know that overfiring won't hurt?
//      - And... if everything doesn't change... hmm... do functions switch between changing everything and just a few? Hmm...

export function deltaMapVariableTest(count: number) {
    let values = eye0_pure(Array(count).fill(0).map((x, i) => i));

    let factor = eye({ value: 1 });
    let factorRaw = 1;

    let baseReads = derivedTotalReads.value;

    let output = derived(() => {
        let f = factor.value;
        let outputMap = deltaArrayMap(values, function(this, i) {
            //console.log(i + "_" + this.f);
            return i * this.f;
        }, { f });
        return { value: outputMap };
    });

    baseReads = derivedTotalReads.value - baseReads;


    let changeReads = derivedTotalReads.value;

    // If it doesn't throw, it means the surrounding closure rewrote the delta call to pass f as a variable, or at least
    //  make deltaArrayMap use eval to access the parent scope. I might never do either, but if it doesn't throw, and evaluates
    //  the output correctly... that's fine.

    ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), Array(count).fill(0).map((x, i) => i).reduce((a, b) => a + b, 0));

    changeReads = derivedTotalReads.value - changeReads;
    
    // deltaArrayMap must really only apply the delta, and not just run over all values every time
    ThrowIfNotImplementsData(changeReads < baseReads / 10, true);

    
    factorRaw = 10;
    factor.value = 10;

    settleDerivedsNow();

    ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), Array(count).fill(0).map((x, i) => i * 10).reduce((a, b) => a + b, 0));
}