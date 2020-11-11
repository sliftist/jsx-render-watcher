// TODO: We also want a replacement for Object.keys, that uses GetCurLookupDelta? Hmm... or... actually, just deltaObjectMap.

import { arrayDelta, GetCurArrayDelta } from "./deltaDefaults";
import { derived, DisposeSymbol, getParentDerived, keepDerivedAlive, DerivedFnc } from "../derived";
import { canHaveChildren } from "../lib/algorithms";
import { eye, eye0_pure } from "../eye";
import { AATree } from "../lib/AATree";
import { UnionUndefined, isPrimitive } from "../lib/type";
import { getObjIdentifier, getCombinedObjectHash } from "../identifer";
import { parseClosed } from "../closeParser/parseClosed";
import { g } from "pchannel";


let rootDerivedObject = Object.create(null);
const RootDerivedSymbol = Symbol("RootDerivedSymbol");


let persistentDeriveds: Map<string, ReturnType<typeof deltaArrayMapBase>> = new Map();

function removeType<RemoveType>() {
    return function<BaseType>(value: BaseType&RemoveType): BaseType {
        return value;
    }
}
function adddType<AddType>() {
    return function<BaseType>(value: BaseType): BaseType&AddType {
        return value as any;
    }
}

export function deltaArrayMap<T, V, ThisContext extends { [key: string]: null|undefined|number|string|boolean }>(
    array: T[],
    mapFnc: (this: ThisContext, input: T) => V,
    thisContextParams: ThisContext = Object.create(null)
) {
    let parentDerived = getParentDerived() || rootDerivedObject;
    let objectHash = getCombinedObjectHash(parentDerived, array);
    let id = getObjIdentifier(objectHash, mapFnc.toString(), mapFnc.name + "." + "map");

    for(let key in thisContextParams) {
        if(!isPrimitive(thisContextParams[key])) {
            // TODO: Support more than primitives. To do this we need to figure out how to solve the problem
            //  of the user accidentally passing nested objects, VS when they pass eyes (and it is the same eye),
            //  so we don't need to do a deep diff. AND we should probably do something similar with the derived output...
            //  and actually make it a helper function to set the value of an eye? That way you can set an eye from
            //  a potentially raw object, and not worry about deep object mutation, BUT, where it isn't slow if
            //  you use eyes (which track deep object mutation anyway).
            throw new Error(`Only primitives are supported in the this context, and the key ${key} was not a primitive type.`);
        }
    }

    let persistentDerived = persistentDeriveds.get(id);
    if(!persistentDerived) {
        persistentDerived = deltaArrayMapBase(array, mapFnc, id, thisContextParams);
        persistentDeriveds.set(id, persistentDerived);
    } else {
        let { thisContextEye } = persistentDerived;
        let allKeys = new Set<string>(Object.keys(thisContextEye).concat(Object.keys(thisContextParams)));
        
        for(let key of allKeys) {
            let prevValue = thisContextEye[key];
            let newValue = thisContextParams[key];
            if(prevValue !== newValue || !(key in thisContextEye)) {
                thisContextEye[key] = newValue;
            }
        }
    }

    // NOTE: The reason we aren't getting the derived infrastructure itself to handle deduping the root derived...
    //  is because later we want to be able to reuse deriveds across parent derives.
    //  - And... persisting deriveds is complex, and really requires a deep understanding of what the underlying
    //      derived function is accessing... so at least for now I don't think we should easily support it
    //      in the root derived. But... maybe after we add good support here, maybe then we can do it,
    //      providing some built context passed to a derived which persists across calls, and the ability to
    //      specify an initialization function, etc. Maybe...
    
    keepDerivedAlive(persistentDerived.array[RootDerivedSymbol]);

    return adddType<V[]>()(removeType<unknown[]>()(persistentDerived.array));
}

function deltaArrayMapBase<T, V, ThisContext extends { [key: string]: unknown }>(
    array: T[],
    mapFnc: (this: ThisContext, input: T) => V,
    id: string,
    thisContextParams: ThisContext
) {
    let globalVariablesAccessed = new Set<string>();
    //todonext;
    // Also check if the function uses bind?
    parseClosed(
        "(" + mapFnc.toString() + ")",
        () => {},
        (declScope, varName) => {
            if(declScope) return;
            if(g.TEST) {
                // Allow some test instrumentation
                if(varName.startsWith("$_$") && varName !== "$_$tracer") {
                    return;
                }
            }
            globalVariablesAccessed.add(varName);
        }
    );

    if(globalVariablesAccessed.size > 0) {
        // Temporarily comment out, so we can test some instrument code, forcing it to use global variables...
        //throw new Error(`Tried to use a delta map function that uses variables in the parent scope. We can't tell if these change, so we can't safely apply the delta map function. Specific which values you are using to the delta map, and then access them in the this context of your map fnc. Variables ${Array.from(globalVariablesAccessed.keys()).map(x => JSON.stringify(x)).join(", ")}`);
    }

    
    let indexesTree = new AATree<void, number>(
        (lhs, rhs) => lhs.beforeSum - rhs.beforeSum,
        x => 1,
        (lhs, rhs) => lhs + rhs,
        0
    );

    let thisContextEye = eye0_pure(thisContextParams, "deltaThisContext");

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

                rawOutputValue = mapFnc.call(thisContextEye, inputValue);
                // Only set it directly after we have inserted it into the array.
                if(indexNode) {
                    let index = indexesTree.GetLeftSum(indexNode) || 0;
                    outputArray[index] = canHaveChildren(rawOutputValue) ? outputValue : rawOutputValue;
                }
                return rawOutputValue;
            }, id + "." + insertIndex, undefined, "weak");            

            outputArray.splice(insertIndex, 0, canHaveChildren(rawOutputValue) ? outputValue : rawOutputValue);
            derivedArray.splice(insertIndex, 0, outputValue);

            // Set the value to insertIndex for debugging.
            indexNode = UnionUndefined(indexesTree.Add(insertIndex as any, insertIndex));
        }

        return outputArray;
    }, id, undefined, true, () => {
        (persistentDeriveds as any).delete(id);
    });

    return {
        array: Object.assign(outputArray, {
            [DisposeSymbol]() {
                rootDerived[DisposeSymbol]();
            },
            [RootDerivedSymbol]: rootDerived
        }),
        thisContextEye
    };
}