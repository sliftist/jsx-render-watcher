// TODO: We also want a replacement for Object.keys, that uses GetCurLookupDelta? Hmm... or... actually, just deltaObjectMap.

import { arrayDelta, GetCurArrayDelta } from "./deltaDefaults";
import { derived, DisposeSymbol, getParentDerived, keepDerivedAlive } from "../derived";
import { canHaveChildren } from "../lib/algorithms";
import { eye, eye0_pure } from "../eye";
import { AATree } from "../lib/AATree";
import { UnionUndefined } from "../lib/type";
import { getObjIdentifier, getCombinedObjectHash } from "../identifer";


let rootDerivedObject = Object.create(null);
let RootDerivedSymbol = Symbol("RootDerivedSymbol");

let persistentDeriveds: Map<string, any> = new Map();

export function deltaArrayMap<T, V>(
    array: T[],
    mapFnc: (input: T) => V
): (V[]) & { [DisposeSymbol](): void } {
    let parentDerived = getParentDerived() || rootDerivedObject;
    let objectHash = getCombinedObjectHash(parentDerived, array);
    let id = getObjIdentifier(objectHash, mapFnc.toString(), mapFnc.name + "." + "map");

    let persistentDerived = persistentDeriveds.get(id);
    if(!persistentDerived) {
        persistentDerived = deltaArrayMapBase(array, mapFnc, id);
        persistentDeriveds.set(id, persistentDerived);
    }
    // NOTE: The reason we aren't getting the derived infrastructure itself to handle deduping the root derived...
    //  is because later we want to be able to reuse deriveds across parent derives.
    //  - And... persisting deriveds is complex, and really requires a deep understanding of what the underlying
    //      derived function is accessing... so at least for now I don't think we should easily support it
    //      in the root derived. But... maybe after we add good support here, maybe then we can do it,
    //      providing some built context passed to a derived which persists across calls, and the ability to
    //      specify an initialization function, etc. Maybe...
    keepDerivedAlive(persistentDerived[RootDerivedSymbol]);
    return persistentDerived;
}

function deltaArrayMapBase<T, V>(
    array: T[],
    mapFnc: (input: T) => V,
    id: string
) {
    
    let indexesTree = new AATree<void, number>(
        (lhs, rhs) => lhs.beforeSum - rhs.beforeSum,
        x => 1,
        (lhs, rhs) => lhs + rhs,
        0
    );

    let outputArray = eye0_pure([] as V[]);
    let derivedArray: ReturnType<typeof derived>[] = [];
    let rootDerived = derived(() => {
        let delta = GetCurArrayDelta(array);

        for(let removeIndex of delta.removes) {
            if(removeIndex < 0) removeIndex = ~removeIndex;

            let derivedValue = derivedArray[removeIndex];
            derivedValue[DisposeSymbol]();

            outputArray.splice(removeIndex, 1);
            derivedArray.splice(removeIndex, 1);

            indexesTree.Remove(undefined, removeIndex);
        }
        for(let insertIndex of delta.inserts) {
            if(insertIndex < 0) insertIndex = ~insertIndex;

            let inputValue = array[insertIndex];

            let rawOutputValue!: V;
            let indexNode: ReturnType<typeof indexesTree.Add>|undefined;

            let outputValue = derived(() => {
                // NOTE: We don't have to worry about this running after it is removed, as we call dispose on the
                //  derived value, which explicitly prevents the derived from running again.

                rawOutputValue = mapFnc(inputValue);
                // Only set it directly after we have inserted it into the array.
                if(indexNode) {
                    let index = indexesTree.GetLeftSum(indexNode) || 0;
                    outputArray[index] = canHaveChildren(rawOutputValue) ? outputValue : rawOutputValue;
                }
                return rawOutputValue;
            }, id + "." + insertIndex, undefined, "weak");            

            outputArray.splice(insertIndex, 0, canHaveChildren(rawOutputValue) ? outputValue : rawOutputValue);
            derivedArray.splice(insertIndex, 0, outputValue);

            indexNode = UnionUndefined(indexesTree.Add(undefined, insertIndex));
        }

        return outputArray;
    }, id, undefined, true, () => {
        persistentDeriveds.delete(id);
    });

    return Object.assign(outputArray, {
        [DisposeSymbol]() {
            rootDerived[DisposeSymbol]();
        },
        [RootDerivedSymbol]: rootDerived
    });
}