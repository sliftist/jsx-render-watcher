import { eye0_pure, EyeType, eye, eye1_replace } from "./eye";
import { derived, derivedRaw, DisposeSymbol, globalAliveDerivedCount, settleDerivedsNow } from "./derived";
import { derivedTotalReads } from "./derivedStats";
import { GetCurLookupDelta, GetCurArrayDelta, ArrayDelta } from "./delta/deltaDefaults";
import { ThrowIfNotImplementsData } from "pchannel";
import { getObjIdentifier } from "./identifer";
import { deltaArrayMap } from "./delta/deltaMap";

import { parse } from '@typescript-eslint/typescript-estree';
import { parseClosed } from "./closeParser/parseClosed";
import { createFactory } from "react";
import { deltaMapVariableTest } from "./derivedDeltaFncs";


//todonext
//  We need proper maps functions, that allow access of nested values, etc
//  and track those nested or further derived values via registerDeltaReadAccess,
//  so derived doesn't need to iterate over all values to find removed values every time...
//todonext
// Set support in proxy

let state: { [key: string]: number } = eye0_pure(Object.create(null));
let lastSum = 0;
let eyeDerived = derived(function (this: any) {
    let changes = GetCurLookupDelta(state);
    for(let { prevValue, newValue } of changes.values()) {
        lastSum -= prevValue || 0;
        lastSum += newValue || 0;
    }
}) as any as EyeType<void>;

describe("derived delta", () => {
    it("lookup basic", async () => {
        let state: { [key: string]: number } = eye0_pure(Object.create(null));
        state["a"] = 1;
        state["b"] = 2;
        for(let i = 0; i < 100; i++) {
            state["v" + i] = 0;
        }

        let baseReads = derivedTotalReads.value;

        let lastSumLoopCount = 0;
        let lastSum = 0;
        derived(function (this: any) {
            lastSumLoopCount = 0;
            let changes = GetCurLookupDelta(state);
            for(let { prevValue, newValue } of changes.values()) {
                lastSumLoopCount++;
                lastSum -= prevValue || 0;
                lastSum += newValue || 0;
            }
        });

        ThrowIfNotImplementsData(lastSum, 3);
        baseReads = derivedTotalReads.value - baseReads;
        //console.log(lastSumLoopCount, baseReads);


        let readsForChanges = derivedTotalReads.value;

        state["c"] = 1;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 4);
        ThrowIfNotImplementsData(lastSumLoopCount, 1);
        lastSumLoopCount = 0;

        delete state["c"];
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 3);
        ThrowIfNotImplementsData(lastSumLoopCount, 1);
        lastSumLoopCount = 0;

        state["d"] = 5;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 8);
        ThrowIfNotImplementsData(lastSumLoopCount, 1);
        lastSumLoopCount = 0;
        
        state["d"] = 7;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSumLoopCount, 1);
        ThrowIfNotImplementsData(lastSum, 10);

        readsForChanges = derivedTotalReads.value - readsForChanges;

        // There have to be some read changes! Of there are none, then we must not be tracking changes properly!
        ThrowIfNotImplementsData(readsForChanges > 0, true);

        //console.log(readsForChanges, baseReads);

        // We should have far fewer reads when just makes a few changes to the lookup than when we
        //  had to create the entire lookup.
        ThrowIfNotImplementsData(readsForChanges < baseReads / 10, true);
    });

    it("array basic", async () => {
        let arr: number[] = eye(Array(100).fill(0).map((x, i) => i));

        derivedTotalReads.value = 0;
        let baseReads = derivedTotalReads.value;

        let loops = 0;
        let lastSum = 0;
        let prevValues: number[] = [];
        derived(() => {
            let delta = GetCurArrayDelta(arr);
            for(let removeIndex of delta.removes) {
                if(removeIndex < 0) removeIndex = ~removeIndex;
                lastSum -= prevValues[removeIndex];
                prevValues.splice(removeIndex, 1);
                loops++;
            }
            for(let insertIndex of delta.inserts) {
                if(insertIndex < 0) insertIndex = ~insertIndex;
                let newValue = arr[insertIndex];
                prevValues.splice(insertIndex, 0, newValue);
                lastSum += newValue;
                loops++;
            }
        });

        ThrowIfNotImplementsData(lastSum, 4950);
        //console.log(lastSum);
        //console.log(derivedTotalReads.value);

        baseReads = derivedTotalReads.value - baseReads;


        let readsForChanges = derivedTotalReads.value;
        loops = 0;

        arr[0] = 100;
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 5050);


        arr.splice(50, 1);
        await Promise.resolve();
        ThrowIfNotImplementsData(lastSum, 5000);


        readsForChanges = derivedTotalReads.value - readsForChanges;


        //console.log(readsForChanges, baseReads);
        // Making a few changes should be require A LOT fewer reads than 
        ThrowIfNotImplementsData(readsForChanges < baseReads / 10, true);

        // We should have few loops, and not loop over everything.
        ThrowIfNotImplementsData(loops < 10, true);
    });



    it("array object", async () => {
        let derivedAdded = globalAliveDerivedCount;

        let arrRaw: {i: number}[] = Array(100).fill(0).map((x, i) => ({i}));
        let arr = eye0_pure(arrRaw);

        let baseReads = derivedTotalReads.value;


        let loops = 0;
        let lastSum = 0;
        
        let prevValues: number[] = [];
        let numberValues = deltaArrayMap(arr, x => x.i);

        let lastDelta!: ArrayDelta;
        //debugger;
        let rootDerived = derived(() => {
            let delta = lastDelta = GetCurArrayDelta(numberValues);
            for(let removeIndex of delta.removes) {
                if(removeIndex < 0) removeIndex = ~removeIndex;
                lastSum -= prevValues[removeIndex];
                prevValues.splice(removeIndex, 1);
                loops++;
            }
            for(let insertIndex of delta.inserts) {
                if(insertIndex < 0) insertIndex = ~insertIndex;

                let value = numberValues[insertIndex];

                lastSum += value;
                
                prevValues.splice(insertIndex, 0, value);

                loops++;
            }
        });

        ThrowIfNotImplementsData(lastSum, arrRaw.map(x => x.i).reduce((a, b) => a + b, 0));
        //console.log(lastSum);
        //console.log(derivedTotalReads.value);

        baseReads = derivedTotalReads.value - baseReads;


        let readsForChanges = derivedTotalReads.value;
        loops = 0;


        arr[0] = { i: 101 };
        await settleDerivedsNow();
        ThrowIfNotImplementsData(lastSum, arrRaw.map(x => x.i).reduce((a, b) => a + b, 0));


        arr[1].i = 0;
        await settleDerivedsNow();
        ThrowIfNotImplementsData(lastSum, arrRaw.map(x => x.i).reduce((a, b) => a + b, 0));


        arr.splice(50, 1);
        await settleDerivedsNow();
        ThrowIfNotImplementsData(lastSum, arrRaw.map(x => x.i).reduce((a, b) => a + b, 0));


        readsForChanges = derivedTotalReads.value - readsForChanges;


        //console.log(readsForChanges, baseReads);
        // Making a few changes should be require A LOT fewer reads than 
        ThrowIfNotImplementsData(readsForChanges < baseReads / 10, true);

        // We should have few loops, and not loop over everything.
        ThrowIfNotImplementsData(loops < 10, true);

        //console.log({ loops, readsForChanges, baseReads });


        rootDerived[DisposeSymbol]();
        numberValues[DisposeSymbol]();


        derivedAdded = globalAliveDerivedCount - derivedAdded;
        // We should leak any derived.
        ThrowIfNotImplementsData(derivedAdded, 0);
    });

    it("deltaMap attaches to parent properly", async () => {
        let baseReads = derivedTotalReads.value;

        let values = eye0_pure(Array(100).fill(0).map((x, i) => i));

        let useDerived = eye0_pure({ value: true });
        let changeValue = eye0_pure({ value: 0 });

        let output = derived(() => {
            if(!useDerived.value) return [];
            changeValue.value;
            return deltaArrayMap(values, i => i * 10);
        });

        baseReads = derivedTotalReads.value - baseReads;


        {
            let readsForChange = derivedTotalReads.value;
            values.splice(~~(values.length / 2), 1);
            changeValue.value++;
            await settleDerivedsNow();

            readsForChange = derivedTotalReads.value - readsForChange;
            
            //console.log(readsForChange, baseReads);

            // If too many reads occur, it means the delta isn't being reused, and a new one is created per run.
            ThrowIfNotImplementsData(readsForChange < baseReads / 10, true);
        }


        // Stop using the deltaArrayMap
        useDerived.value = false;
        await settleDerivedsNow();

        // Once we stop using the delta array map, it should go away, and not trigger any future reads.
        {
            let readForChangeWeArentWatching = derivedTotalReads.value;

            values.splice(~~(values.length / 2), 1);
            await settleDerivedsNow();
            
            readForChangeWeArentWatching = derivedTotalReads.value - readForChangeWeArentWatching;

            //console.log(readForChangeWeArentWatching);
            ThrowIfNotImplementsData(readForChangeWeArentWatching, 0);
        }
    });


    it("deltaMap either handles closures or throws", async () => {
        let values = eye0_pure(Array(3).fill(0).map((x, i) => i));

        let factor = eye({ value: 1 });

        let baseReads = derivedTotalReads.value;
        let output;
        try {
            output = derived(() => {
                let f = factor.value;
                function fnc(i: number) {
                    return i * f;
                }

                let outputMap = deltaArrayMap(values, fnc);
                return { value: outputMap };
            });
        } catch(e) {
            //console.log(e.message);
            // Fine, if it throws, it means it detected the closed variable, and gave an error specifying it cannot handle
            //  closed variables
            return;
        }

        baseReads = derivedTotalReads.value - baseReads;


        let changeReads = derivedTotalReads.value;

        // If it doesn't throw, it means the surrounding closure rewrote the delta call to pass f as a variable, or at least
        //  make deltaArrayMap use eval to access the parent scope. I might never do either, but if it doesn't throw, and evaluates
        //  the output correctly... that's fine.

        ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), 3);

        factor.value = 10;
        await settleDerivedsNow();

        ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), 30);


        changeReads = derivedTotalReads.value - changeReads;

        // deltaArrayMap must really only apply the delta, and not just run over all values every time
        ThrowIfNotImplementsData(changeReads < baseReads / 10, true);
    });


    //todonext
    // This test (or some test), is way too slow. Okay so... first, run it just from node...
    //  so we can benchmark the speed without wallabyjs instrumentation.
    //  And then... start trying to benchmark it with stat-profile-2. And... use that as the only test case,
    //  screw ramping up, get that working, and that's all.


    it("deltaMap supports explicit variable passing (10000)", async () => {
        deltaMapVariableTest(10000);
    });

    it("deltaMap supports explicit variable passing (1000)", async () => {
        deltaMapVariableTest(1000);
    });

    it("deltaMap supports explicit variable passing (100)", async () => {
        deltaMapVariableTest(100);
    });



    async function deltaMapComparable(count: number) {
        let values = Array(count).fill(0).map((x, i) => i);
        let factor = { value: 1 };

        let baseReads = derivedTotalReads.value;

        let output: {value: number[] } = {value: []};
        function derivedCalculation() {
            output.value = values.map(i => i * factor.value);
        }

        derivedCalculation();

        ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), Array(count).fill(0).map((x, i) => i).reduce((a, b) => a + b, 0));

        factor.value = 10;

        derivedCalculation();

        ThrowIfNotImplementsData(output.value.reduce((a, b) => a + b, 0), Array(count).fill(0).map((x, i) => i * 10).reduce((a, b) => a + b, 0));
    }

    it("deltaMap comparable (10000)", async () => {
        deltaMapComparable(10000);
    });

    it("deltaMap comparable (1000)", async () => {
        deltaMapComparable(1000);
    });

    it("deltaMap comparable (100)", async () => {
        deltaMapComparable(100);
    });

    async function fillMap(count: number) {
        let values = Array(count).fill(0).map((x, i) => i);
        let factor = { value: 1 };

        let output: {value: number[] } = {value: []};
        function derivedCalculation() {
            output.value = values.map(i => i * factor.value);
        }

        derivedCalculation();
    }


    it("fill map (10000)", async () => {
        fillMap(10000);
    });

    it("fill map (1000)", async () => {
        fillMap(1000);
    });

    it("fill map (100)", async () => {
        fillMap(100);
    });

    // TODO: After we support the above regular map case, support the case of a mapped inside of a derived, which
    //  requires making assumptions that the map value is completely dependent on the mapFnc.toString()
    //  - OH! I mean, make the derived have a unique value and some kind of cache based on the parent derived?
    //      - So, if the same parent derived calls it, it will use the same child derived? Yeah... that sounds good.
    //  - Which is an invalid assumption if any variables are closed upon, so... then also add something to parse
    //      the javascript of the function to determine what it closes on, and add the code to allow checking for those
    //      values.
    // And then make sure our dispose works properly (I think I disabled it), so when the derived is no longer accessed in
    //  the parent derived, it disposes properly (very important, to prevent the function rerunning forever).
    //todonext
    // Add a failing test for for deltaArrayMap, that fails because of closure value changes. And then... add a javascript
    //  parser and determine all closed variables.
    //  - Then... maybe add a warning for variables closed upon that don't look like imports? We can be fairly strict,
    //      even disallowing everything, but then we should make it possible to specify which variables you want to provide
    //      to the function, as arguments?
    //  - Then add a helper function to trick the user into calling eval, so we can check their scope to see if the closed
    //      upon variables have changed... allowing us to re-evaluate the function appropriately, accessing the new
    //      closed upon variables, making variable closures not a major problem.

    // TODO: Ah, but... if one of our parent scopes uses a derived, AND, that derived doesn't use any values from it's parent scope
    //  (recursively, meaning we only use values from that derived's scope), then we could actually have the parent derived rewrite it's
    //  function to explicitly pass in scoped values.
    //  - And if we put a derived at the root? Or something to transform our child code at the root, passing in our require function
    //      as an argument... then we would almost always (unless they use window stuff) transform code to explicitly pass closed upon
    //      values to derived, eliminating the need for eval.
    //      - Of course, rewriting the code would require updating sourcemaps... probably... unless we can stick
    //          everything we add at the end of an existing line?


    // TODO: Object support, that does everything we added to arrays.
    //  - This is easier, because objects already have an easy way to manipulate them. However... we will want an
    //      "objectToArrayWithSort" function, that then uses it to do binary searches on the final array via the sort
    //      function, which allows for fast deletions (and primitive updates).
    //      - It's a pity that most users will still do Object.values(obj).sort()... but...
    //          - Hmm... when we add .sort() to delta arrays, is it possible to allow that to propogate back up to the original
    //              derived? I mean, if they don't access it at all between the creation and the sort, then we know the intermediate
    //              default state doesn't matter, and then creating it in the sort order is MUCH easier, and eliminates the need
    //              for the IndexTree...
    //          - OR! Even better! we could have .sort() from the input delta array propogate down, so when a nested object is updated,
    //              it can find its current index via searching via the sort order (and then linear searching it after it finds
    //              the binarySearchLeft value).
});