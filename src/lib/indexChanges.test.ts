import { ArrayDelta } from "../delta/deltaDefaults";
import { ArrayMutation, getChanges, MutationList, addDeltaMoves, AATreeArrayGetChanges } from "./indexChanges";
import { ThrowIfNotImplementsData, g } from "pchannel";

import { MersenneTwister19937 } from "random-js";
import { globalNextId } from "./misc";

interface TestObj {
    value: string;
}
const alphabet = "etaoinsrhdlucmfywgpbvkxqjz";
const nextTextSeqNum = Symbol();
function randomText(): string {
    return globalNextId().toString();

    let len = randLog(20) + 4;
    let alphaSize = randLog(8) + 3;
    let alpha: string[] = [];
    for(let i = 0; i < alphaSize; i++) {
        while(true) {
            let ch = alphabet[randLog(alphabet.length)];
            if(alpha.includes(ch)) continue;
            alpha.push(ch);
            break;
        }
    }

    let output = "";
    for(let i = 0; i < len; i++) {
        output += alpha[rand(alpha.length)];
    }
    return output;
}

let randFnc = Math.random;

function randLog(max: number): number {
    let rand = randFnc();
    let index = Math.floor(2 ** (rand * Math.log2(max + 1)) - 1);
    if(index >= max) index = max - 1;
    return index;
}
function rand(max: number): number {
    return Math.floor(randFnc() * max);
}

function applyArrayDelta<T>(delta: ArrayDelta, arr: T[], newArr: T[]): void {
    let auxStack = [];
    for(let removeIndex of delta.removes) {
        if(removeIndex < 0) {
            removeIndex = ~removeIndex;
            auxStack.push(arr[removeIndex]);
        }
        arr.splice(removeIndex, 1);
    }

    let auxIndex = 0;
    for(let insertIndex of delta.inserts) {
        let value;
        if(insertIndex >= 0) {
            value = newArr[insertIndex];
        } else {
            value = auxStack[auxIndex++];
        }
        arr.splice(insertIndex, 0, value);
    }
}
function applyArrayMutations<T>(mutations: (ArrayMutation&{values: T[]})[], arr: T[]) {
    for(let mutation of mutations) {
        if(mutation.sizeDelta < 0) {
            arr.splice(mutation.index, -mutation.sizeDelta);
        } else {
            arr.splice(mutation.index, 0, ...mutation.values);
        }
    }
}
function createRandomMutation(arrayLength: number): ArrayMutation&{values: TestObj[]} {
    let index = randLog(arrayLength);
    let length = randLog(arrayLength);
    if(length === 0) length = 1;
    if(randFnc() < 0.5) {
        // Delete
        return { index, sizeDelta: -length, values: [] };
    } else {
        let values: TestObj[] = [];
        for(let i = 0; i < length; i++) {
            values.push({ value: randomText() });
        }
        return { index, sizeDelta: length, values };
    }
}
function createTestArray(arrayLength: number): TestObj[] {
    let values: TestObj[] = [];
    for(let i = 0; i < arrayLength; i++) {
        values.push({ value: randomText() });
    }
    return values;
}

function testGetChanges(arr: TestObj[], mutations: (ArrayMutation&{values: TestObj[]})[], smallSplitFactor: boolean, dontThrow:boolean|"throw"=true): void {
    if(dontThrow === false) {
        //debugger;
    }
    let originalArr = arr.slice();

    let arrForDelta = arr.slice();

    applyArrayMutations(mutations, arr);

    if(dontThrow === "throw") {
        debugger;
    }

    let changes = getChanges(originalArr.length, mutations, smallSplitFactor);

    let changes2 = AATreeArrayGetChanges(originalArr.length, mutations);

    ThrowIfNotImplementsData(changes.auxOrder.length, changes2.auxOrder.length);
    ThrowIfNotImplementsData(changes.removes.length, changes2.removes.length);
    ThrowIfNotImplementsData(changes.inserts.length, changes2.inserts.length);

    for(let i = 0; i < changes.removes.length; i++) {
        ThrowIfNotImplementsData(changes.removes[i], changes2.removes[i]);
    }
    for(let i = 0; i < changes.inserts.length; i++) {
        ThrowIfNotImplementsData(changes.inserts[i], changes2.inserts[i]);
    }
    

    applyArrayDelta(changes, arrForDelta, arr);

    if(dontThrow === false) {
        console.log("mutations", mutations.map(x => ({index: x.index, size: x.sizeDelta})));
        console.log("insert values", mutations.map(x => x.values));
        console.log("changes", changes);
        console.log("originalArr", originalArr.length, originalArr);
        console.log("arr", arr.length, arr);
        console.log("arrForDelta", arrForDelta.length, arrForDelta);

        debugger;

        console.log(mutations.length);
        try {
            console.log(g.curTestName);
            console.log(g.loopIndex);
            console.log(g.mutateIndex);
            //debugger;
            g.breakOnThisMutateIndex = 1;
            testGetChanges(originalArr.slice(), mutations.slice(0, 2), smallSplitFactor, "throw");
        } catch(e) {
            debugger;
            console.log("threw again", e);
        }

        debugger;
    }

    //todonext
    //  The issue is that the insert index is off. It should be 1, but is 0.
    //  This is a probably an issue with boundary behavior
    //  Nope, it is an ordering issue with values
    if(dontThrow === true) {
        try {
            ThrowIfNotImplementsData(arrForDelta, arr);
        } catch {
            testGetChanges(originalArr, mutations, smallSplitFactor, false);
        }
    } else {
        ThrowIfNotImplementsData(arrForDelta, arr);
    }
}

function wrapRandom(seedInt: number, code: () => void) {
    const mt = MersenneTwister19937.seed(seedInt)
    randFnc = () => Math.abs(mt.next()) / (2**31);
    let randomOriginal = Math.random;
    Math.random = randFnc;
    try {
        code();
    } finally {
        Math.random = randomOriginal;
        randFnc = Math.random;
    }
}

describe("indexChanges", () => {
    it("test basic", () => {
        wrapRandom(2463423, () => {
            let arr: TestObj[] = [
                { value: "a" },
                { value: "b" },
                { value: "c" },
                { value: "d" },
                { value: "e" },
                { value: "f" },
            ];

            //console.log(linkedListToList(sumList.valueRoot as any).map(x => [x.value, x.sumIncluded]));

            testGetChanges(arr, [
                { index: 1, sizeDelta: -1, values: [] },
                { index: 1, sizeDelta: 1, values: [ { value: "aa" } ] }
            ], true);
        });
    });

    function testScale(scale: number, rootCount = 1000 / (10 ** scale)) {
        wrapRandom(2451, () => {
            for(let i = 0; i < rootCount; i++) {
                g.loopIndex = i;

                let size = Math.round((10 ** (scale + 0.5)) * (1 - (randFnc() - 0.5) * 0.1));
                size = Math.floor(10 ** (scale + 1) * (randFnc() * 0.9 + 0.1));
                
                //console.log("size", size);
                let arr = createTestArray(size);
                (randFnc as any)[nextTextSeqNum] += 10;

                let mutations = new Array(size * 5).fill(0).map(x => createRandomMutation(size));

                try {
                    testGetChanges(arr, mutations, true);
                } catch(e) {
                    console.log({scale, i, size}, g.mutateIndex);
                    throw e;
                }
            }
        });
    }

    it("test small scale 0", () => {
        testScale(0, 10);
    });

    /*
    it("test large scale 0", () => {
        testScale(0);
    });
    */

    /*
    it("test small scale 1", () => {
        testScale(1, 1);
    });
    */
    /*
    it("test small scale 2", () => {
        testScale(2, 1);
    });

    it("test large scale 1", () => {
        testScale(1);
    });
    it("test large scale 2", () => {
        testScale(2);
    });
    */

    it("list test", () => {
        let length = 100;
        let mutations: ArrayMutation[] = [];
        mutations = new Array(length / 2).fill(0).map((x, i) => ({ index: i * 2, sizeDelta: -1 }));
        mutations.push({ index: length / 2, sizeDelta: 10 });
        getChanges(length, mutations, false);
    });
});

describe("addDeltaMoves", () => {
    it("basic", () => {
        let list = Array(100).fill(0).map((x, i) => i);
        let mutations = new MutationList(list.length);

        let prevOrder = list.slice();

        let index = 10;
        let count = 10;
        let elements = list.splice(index, count);
        list.splice(-index, 0, ...elements);

        mutations.addMutation(index, -count);
        mutations.addMutation(-index, count);


        let delta = mutations.getDelta();
        addDeltaMoves(delta, prevOrder, list);

        ThrowIfNotImplementsData(delta, {
            auxOrder: [ 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 ],
            inserts: [ -81, -82, -83, -84, -85, -86, -87, -88, -89, -90 ],
            removes: Array(10).fill(0).map((x, i) => i + index).reverse().map(x => ~x)
        });
    });
});