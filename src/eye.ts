import { registerReadAccess, registerWrite, registerKeysReadAccess, registerOwnKeysWrite, registerDeltaReadAccess, ReadDelta } from "./accessEvents";
import { getRootKey, getChildPath, getParentPath, getKeyHash, joinHashes } from "./lib/path";
import { unreachable, canHaveChildren } from "./lib/algorithms";
import { g } from "./lib/misc";
import { arrayDelta, KeyDeltaChanges, ArrayDeltaObj, ArrayDelta, lookupDelta } from "./delta/deltaDefaults";
import { MutationList, ArrayDeltaHolder } from "./lib/indexChanges";
import { createNewIdentifier } from "./identifer";
import { DeltaState, DeltaStateId, DeltaContext } from "./delta/DeltaContext";

// TODO: Support the ability to get a size of an object, via maintaining it, and possibly via returning a promise,
//  and then using an external thread to maybe check the initial size via a thread, so we don't block the main
//  thread with a Object.keys() call on a huge object.

/** Returned from eyes, to indicate what they are. */
export const EyeLevelMark = Symbol("EyeLevelMark");
export const EyeId = Symbol("EyeId");
/** Prevents an object's children from being watched by eyes. */
export const UnEyeMark = Symbol("UnEyeMark");
export const EyeRawValue = Symbol("EyeRawValue");



export const Eye0_pure = Symbol("Eye0_pure");
export const Eye1_replace = Symbol("Eye1_replace");



export enum EyeLevel {
    eye0_pure = 0,
    eye1_replace = 1,
};

let levelToSymbol = {
    [EyeLevel.eye0_pure]: Eye0_pure,
    [EyeLevel.eye1_replace]: Eye1_replace,
};

export type EyeType<T> = T & {
    [EyeRawValue]: unknown;
    [EyeId]: string;
};


/**
 * 
 * @param initialState 
 * @param pathOverride Overrides the base path used for properties inside this eye. Be careful, if this collides
 *              with other paths we will assume the collision was intentional, and weird things may happen.
 * 
 *  NOTE: We only support tracking changes that are children of eyes, not changes to the eyes themselves. This means eyes
 *      cannot wrap primitives, such as a string or a number.
 */
export function eye<T extends object>(
    initialState: T,
    level = EyeLevel.eye0_pure,
    niceName?: string
): EyeType<T> {
    return eyeInternal(initialState, level, niceName);
}

/** Eye is pure, it does not mutate underlying state (and so is stored as a replacement of the state) */
export function eye0_pure<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye0_pure, niceName);
}
/** Eye writes symbols to the root, and then replaces the entire tree with eyes (and writes symbols) */
export function eye1_replace<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye1_replace, niceName);
}


function isEye(obj: unknown): false|true|"replace" {
    if(!canHaveChildren(obj)) return false;
    let value = (obj as any)[EyeLevelMark];
    if(value === EyeLevel.eye0_pure) return true;
    if(value === EyeLevel.eye1_replace) return "replace";
    return false;
}

function unwrapEye(value: unknown) {
    if(canHaveChildren(value) && EyeRawValue in value) {
        return (value as any)[EyeRawValue];
    }
    return value;
}

// NOTE: We only store the values temporarily, still allowing the underlying state to store the real values. This means
//  that we don't cause a memory leak by permanently storing previous values. However, it also means that if the underlying
//  raw values change, we may give the incorrect previous state. However... in this case we are also likely to simply miss
//  changes, so there is no real solution to unproxied accesses.
// NOTE: If in a DeltaContext run this state is not accessed, the DeltaContext automatically removes it. So if nothing
//  requests delta, we don't have any, and so we have nothing to maintain. So adding delta management directly to eye is free.
interface EyeLookupDeltaState extends DeltaState {
    fullReads: ReadDelta["fullReads"];
    curChanges: {changes: KeyDeltaChanges<unknown>; }|undefined;
    nextChanges: {changes: KeyDeltaChanges<unknown>; };
}
function eyeDeltaStateConstructor(lookup: { [key: string]: unknown }): EyeLookupDeltaState {
    let state: EyeLookupDeltaState = {
        fullReads: new Set(),
        curChanges: undefined,
        nextChanges: { changes: new Map(), },
    };
    for(let key in lookup) {
        addLookupChange(key, undefined, lookup[key], state);
    }
    return state;
}
function createLookupDeltaId() {
    let deltaId: DeltaStateId<EyeLookupDeltaState> = {
        startRun(state) {
            if(state.curChanges) throw new Error(`Internal error, startRun called before finishRun called`);
            state.curChanges = state.nextChanges;
            // All the changes that happen after a run starts, until the next run starts, should be queued for the next
            //  run. It must be done in startRun and not finishRun in case a run modifies it's own state, and therefore has to rerun.
            //  (queued, IN ADDITION to being added to curChanges)
            state.nextChanges = { changes: new Map(), };
        },
        finishRun(state) {
            state.curChanges = undefined;
        }
    }
    return deltaId;
}
/** Should be called if the value changes, OR if it is added, OR if it is deleted */
function onKeyChangeLookup(key: string, prevValue: unknown, newValue: unknown, id: DeltaStateId<EyeLookupDeltaState>) {
    let states = DeltaContext.GetAllStates(id);
    for(let state of states) {
        addLookupChange(key, prevValue, newValue, state);
    }
}
function addLookupChange(
    key: string,
    prevValue: unknown,
    newValue: unknown,
    state: EyeLookupDeltaState
) {
    if(state.curChanges) {
        addLookupChangeBase(key, prevValue, newValue, state.curChanges);
    }
    addLookupChangeBase(key, prevValue, newValue, state.nextChanges);
}
function addLookupChangeBase(
    key: string,
    prevValue: unknown,
    newValue: unknown,
    delta: EyeLookupDeltaState["nextChanges"],
) {
    let { changes } = delta;

    let prevDelta = changes.get(key);
    if(!prevDelta) {
        changes.set(key, { prevValue, newValue });
    } else {
        // (Only set newValue, keeping the prevValue, as previous is in reference to the previous run, not the previous set).
        prevDelta.newValue = newValue;
    }
}

function wrapMapFunctions(
    state: Map<unknown, unknown>,
    prop: string,
    eyeId: string,
    onRead: (propBadType: PropertyKey, rawValue: unknown) => unknown,
    onWrite: (propBadType: PropertyKey, newValue: unknown, deleted: boolean) => void,
) {
    function validateMapKey(key: unknown): key is PropertyKey {
        if(typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
            return true;
        } else {
            // TODO: We can support this on the eye levels that allow object mutation, by adding our own key to the object in a symbol property.
            throw new Error(`Wrapping Map that uses non primitive keys is not supported yet.`);
        }
    }
    if(prop === "has") {
        return function mapHas(this: Map<unknown, unknown>, key: unknown) {
            if(!validateMapKey(key)) return;
            onRead(key, undefined);
            return state.has(key);
        };
    }
    if(prop === "delete") {
        return function mapDelete(this: Map<unknown, unknown>, key: unknown) {
            if(!validateMapKey(key)) return;
            onRead(key, undefined);
            onWrite(key, undefined, true);
            return state.delete(key);
        };
    }
    if(prop === "get") {
        return function mapGet(this: Map<unknown, unknown>, key: unknown) {
            if(!validateMapKey(key)) return;
            let result = state.get(key);
            return onRead(key, result);
        };
    }
    if(prop === "set") {
        return function mapSet(this: Map<unknown, unknown>, key: unknown, value: unknown) {
            if(!validateMapKey(key)) return;
            state.set(key, value);
            return eye;
        };
    }
    if(prop === "entries") {
        return function mapEntries(this: Map<unknown, unknown>) {
            registerKeysReadAccess(eyeId);
            let results: unknown[] = [];
            for(let [key, value] of state.entries()) {
                if(!validateMapKey(key)) return;
                value = onRead(key, value);
                results.push([key, value]);
            }
            return results;
        };
    }
    if(prop === "keys") {
        return function mapKeys(this: Map<unknown, unknown>) {
            registerKeysReadAccess(eyeId);
            let results: unknown[] = [];
            for(let key of state.keys()) {
                if(!validateMapKey(key)) return;
                onRead(key, undefined);
                results.push(key);
            }
            return results;
        };
    }
    if(prop === "values") {
        return function mapValues(this: Map<unknown, unknown>) {
            registerKeysReadAccess(eyeId);
            let results: unknown[] = [];
            for(let [key, value] of state.entries()) {
                if(typeof key === "object") {
                    throw new Error(`Non-primitive keys not supported in eye wrapped Maps yet`);
                }
                value = onRead(key as any, value);
                results.push(value);
            }
            return results;
        };
    }
    if(prop === "clear") {
        return function mapValues(this: Map<unknown, unknown>) {
            registerKeysReadAccess(eyeId);
            for(let key of state.keys()) {
                if(typeof key === "object") {
                    throw new Error(`Non-primitive keys not supported in eye wrapped Maps yet`);
                }
                onWrite(key as any, undefined, true);
            }
            state.clear();
        };
    }
    // forEach
    throw new Error(`Unhandled Map function, ${prop}`);
}



interface EyeArrayDeltaState extends DeltaState {
    fullReads: ReadDelta["fullReads"];

    curChanges: { changes: ArrayDeltaHolder; }|undefined;
    nextChanges: { changes: ArrayDeltaHolder; };

    underlyingArray: unknown[];
}
function eyeArrayDeltaStateConstructor(array: unknown[]): EyeArrayDeltaState {
    let state: EyeArrayDeltaState = {
        fullReads: new Set(),
        curChanges: undefined,
        nextChanges: { changes: new ArrayDeltaHolder(array, true), },
        underlyingArray: array,
    };
    return state;
}
function createArrayDeltaId() {
    let deltaId: DeltaStateId<EyeArrayDeltaState> = {
        startRun(state) {
            if(state.curChanges) throw new Error(`Internal error, startRun called before finishRun called`);
            state.curChanges = state.nextChanges;
            state.nextChanges = { changes: new ArrayDeltaHolder(state.underlyingArray), };
        },
        finishRun(state) {
            state.curChanges = undefined;
        }
    }
    return deltaId;
}

// Either call onArraySet, OR onArrayLengthChange, NOT BOTH.
function onArraySet(index: number, id: DeltaStateId<EyeArrayDeltaState>) {
    let states = DeltaContext.GetAllStates(id);
    for(let state of states) {
        if(state.curChanges) {
            state.curChanges.changes.onArraySet(index);
        }
        state.nextChanges.changes.onArraySet(index);
    }
}
function onArrayLengthChange(index: number, delta: number, id: DeltaStateId<EyeArrayDeltaState>) {
    let states = DeltaContext.GetAllStates(id);
    for(let state of states) {
        
        if(state.curChanges) {
            state.curChanges.changes.onArrayLengthChange(index, delta);
        }
        state.nextChanges.changes.onArrayLengthChange(index, delta);
    }
}


// NOTE: wrapArrayFunctions basically just remaps functions to call our to onArraySet and onArrayLengthChange
//  efficiently. It still maps writes to arrayProxy, it just makes it to so functions like arr.shift()
//  don't result in a write to every single index, and instead only the removed/add, and otherwises keeps
//  track of the index changes via calls to onArrayLengthChange.
function wrapArrayFunctions(
    underlyingArray: unknown[],
    arrayProxy: unknown[],
    prop: string,
    id: DeltaStateId<EyeArrayDeltaState>,
    onLengthChange: () => void,
): Function|undefined {
    // splice
    // push
    // pop
    // unshift
    // shift

    // NOTE: copyWithin "does not mutate the length", and so it should work without wrapping
    //  - fill is the same
    //  - reverse is the same
    //  - sort is the same

    // NOTE: In a few places we use underlyingArray.length. I'm not entirely sure about this, however it should be alright,
    //  as it means places that write to an array don't necessarily incur a .length access, which is nice for debugging,
    //  as conceptionally shift() isn't really reading the length (and it would be strange to see in a debugging tool
    //  that the shift line incurs a length read).

    let spliceFnc: typeof Array.prototype.splice = splice;
    function splice(start: number, deleteCount?: number, ...items: unknown[]): unknown[] {
        if(start < 0) {
            start = arrayProxy.length + start;
        }
        deleteCount = deleteCount || 0;

        // Don't delete more than exists
        deleteCount = Math.min(deleteCount, start + underlyingArray.length);

        let removedItems: unknown[] = [];

        let changedCount = Math.min(deleteCount, items.length);
        for(let i = 0; i < changedCount; i++) {
            arrayProxy[start + i] = items[i];
            removedItems.push(underlyingArray[start + i]);
        }

        // If we aren't changing the length it doesn't really need to be a splice, and our set loop is enough.
        if(deleteCount === items.length) {
            return removedItems;
        }

        for(let i = changedCount; i < deleteCount; i++) {
            removedItems.push(underlyingArray[start + i]);
        }

        // NOTE: We don't trigger explicit changes for the values inserted/deleted, BECAUSE we fire a length change, and
        //  any array accesses will incur a length access (because of explicit code inside onRead), so we will trigger
        //  anyone watching the array.

        onArrayLengthChange(start, items.length - deleteCount, id);
        onLengthChange();

        start += changedCount;
        if(deleteCount > items.length) {
            underlyingArray.splice(start, deleteCount - changedCount);
        } else if(deleteCount < items.length) {
            underlyingArray.splice(start, 0, ...items.slice(changedCount));
        }

        return removedItems;
    }

    if(prop === "splice") {
        return splice;
    }
    if(prop === "push") {
        let fnc: typeof Array.prototype.push = push;
        function push(...items: unknown[]): number {
            splice(underlyingArray.length, 0, ...items);
            // Why does push return the length? Not sure... but that's how array works, so... ugh...
            return arrayProxy.length;
        }
        return push;
    }
    if(prop === "pop") {
        let fnc: typeof Array.prototype.pop = pop;
        function pop() {
            return splice(underlyingArray.length, 1)[0];
        }
        return pop;
    }
    if(prop === "unshift") {
        // unshift(...items: T[]): number;
        let fnc: typeof Array.prototype.unshift = unshift;
        function unshift(...items: unknown[]): number {
            splice(0, 0, ...items);
            // Again, why does unshift return the new length?
            return arrayProxy.length;
        }
        return unshift;
    }
    if(prop === "shift") {
        let fnc: typeof Array.prototype.shift = shift;
        function shift() {
            return splice(0, 1)[0];
        }
        return shift;
    }

    return undefined;
}


// underlying object => eye
const eyeLookup: WeakMap<object, EyeType<unknown>> = new WeakMap();
const eyeLookupReplace: WeakMap<object, EyeType<unknown>> = new WeakMap();
function eyeInternal<T extends object>(
    obj: T,
    level: EyeLevel,
    niceName?: string
): EyeType<T> {
    obj = unwrapEye(obj);
    let currentEye = eyeLookupReplace.get(obj);
    let pureEye = eyeLookup.get(obj);
    if(currentEye === undefined) {
        if(level === EyeLevel.eye0_pure) {
            currentEye = pureEye;
        } else if(pureEye) {
            // Even if we aren't reusing the eye, we should reuse the underlying eye value, so we don't wrap eyes in eyes.
            obj = pureEye[EyeRawValue] as any;
        }
    }
    
    if(currentEye !== undefined) {
        return currentEye as EyeType<T>;
    }

    let eye = eyeInternalBase(obj, level, niceName);
    if(level === EyeLevel.eye0_pure) {
        eyeLookup.set(obj, eye);
    } else if(level === EyeLevel.eye1_replace) {
        eyeLookupReplace.set(obj, eye);
    } else {
        throw new Error(`Internal error, unhandled eye level ${level}`);
    }
    return eye;
}


function eyeInternalBase<T extends object>(
    obj: T,
    level: EyeLevel,
    niceName?: string
): EyeType<T> {
    if(!canHaveChildren(obj)) {
        throw new Error(`Unsupported eye initial state, must be able to have children, was typeof ${typeof obj}`);
    }

    if(isEye(obj)) {
        debugger;
        throw new Error(`Internal error. Tried to nest eyes. We should have caught this before`);
    }

    let lastKeyCountBounds = 0;

    // TODO: If the key is in the prototype, then we shouldn't watch the prototype, as it is probably (has to be?)
    //  a function.
    // TODO: Warnings if they use __proto__?
    // TODO: Maybe prototype support, so instanceof and stuff like that works?

    // TODO: Set and Map support.
    //  - We want to do this in apply(), I believe.


    let eyeId = createNewIdentifier(niceName, level === EyeLevel.eye1_replace ? "r" : "");
    let eyeIdHash = getKeyHash(eyeId);
    function getChildKeyId(key: PropertyKey): string {
        let keyHash = getKeyHash(key);
        return joinHashes(eyeIdHash, keyHash);
    }


    let eye = construct();

    let lookupDeltaId = createLookupDeltaId();
    let arrayDeltaId = createArrayDeltaId();

    return eye;


    function onRead(propBadType: PropertyKey, rawValue: unknown) {
        let prop = propBadType as keyof T;
        
        if(Array.isArray(obj)) {
            if(propBadType !== "length") {
                // Accessing a key in an array implicitly depends on the keys of the array, as if children before us are spliced,
                //  our index changes (or rather, the value at our current index changes). So all array accesses depend on the length
                //  to stay the same, as if the length changes they might change.
                // NOTE: This is a very important optimization.
                //  - There are some cases where the value at an index is explicitly changed, like:
                //      derived(() => console.log(arr[0]))
                //      arr.shift()
                //  In which case, it may be annoying that the derived fires even for push statements (when the array is not empty),
                //      because the first element has not been changed. HOWEVER, if we support the arr[0] case, we would have to
                //      support the arr[10] case, etc, which would force our subscriptions to handle the fact that every index depends
                //      on the indexes before it too. Which... just gets cumbersome, and isn't actually efficient on average,
                //      as on average you still watch N/2 indexes... so the average improvement is 50% less event fires... at the expensive
                //      of N times more subscriptions and N times slower subscription firing...
                registerReadAccess(getChildKeyId("length"));
            }
        }

        registerReadAccess(getChildKeyId(prop));

        let descriptor = Object.getOwnPropertyDescriptor(obj, propBadType);
        if(descriptor) {
            if(!descriptor.writable && !descriptor.configurable) {
                // Otherwise an error is thrown, like:
                //  "TypeError: 'get' on proxy: property 'prototype' is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value (expected '[object Array]' but got '[object Object]')"
                // TODO: This isn't safe, because non-writable is shallow, so it could have nested properties that are writable. So... we should
                //  iterate deeper into rawValue to try to find the first writable or configurable properties and replace those with proxies?
                //  (if we are eye1_replace)
                // TODO: Test the original error more, is it a check around proxy? Perhaps we should just not even pass the real
                //  state to the proxy... as if all it uses it for is checks to restrict us... then why bother?
                return rawValue;
            }
        }

        if(!canHaveChildren(rawValue) || UnEyeMark in rawValue) {
            // Any primitives can be returned immediately, as they won't (can't) have nested accesses
            return rawValue;
        }

        if(typeof rawValue === "function" && !Object.isExtensible(rawValue)) {
            // Not entirely correct, just because it isn't extensible doesn't mean it is immutable. However
            //  if it is a non-extensible *function* we should probably just not touch it.
            return rawValue;
        }

        if(level === EyeLevel.eye1_replace) {
            let childEye = eye1_replace(rawValue);
            if(isEye(rawValue) !== "replace" && descriptor?.writable) {
                obj[prop] = childEye as any;
            }
            return childEye;
        } else if(level === EyeLevel.eye0_pure) {
            return eye0_pure(rawValue);
        } else {
            throw new Error(`Internal error, unhandled level ${level}`);
        }
    }
    function onWrite(propBadType: PropertyKey, newValue: unknown, deleted: boolean) {

        let prop = propBadType as keyof T;

        let oldValue = obj[prop];

        if(typeof propBadType !== "symbol") {
            let index = +prop;
            if(Array.isArray(obj) && Number.isInteger(index)) {
                onArraySet(index, arrayDeltaId);
            } else if(Array.isArray(obj) && prop === "length" && typeof newValue === "number" && Number.isInteger(newValue)) {
                if(typeof oldValue !== "number") {
                    throw new Error(`Internal error, the length property of an array was not of type number.`);
                }
                let newLength = +newValue;
                let oldLength = oldValue;
                // Length is super special, and causes implicit deletes
                if(newLength < oldLength) {
                    for(let i = newLength; i < oldLength; i++) {
                        onWrite(i, undefined, true);
                    }
                    onArrayLengthChange(newLength, oldLength - newLength, arrayDeltaId);
                }
                // If it is >... well... it is a sparse array, and I'm pretty sure the only way you can detect it is by
                //  accessing length, so we can just allow it to be a regular write.
            } else {
                onKeyChangeLookup(String(propBadType), oldValue, newValue, lookupDeltaId);
            }
        }

        let changed = newValue !== oldValue;
        // Array.length is implicitly defined based on the Array properties (see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array#Relationship_between_length_and_numerical_properties),
        //  and while it does trigger a proxy change notification, the actual value changes first.
        // So for Array.length, we always trigger a change.
        if(Object.getPrototypeOf(obj) === Array.prototype && prop === "length") {
            changed = true;
        }

        // TODO: We COULD do some checks here to see if eye(oldValue) === newValue (which happens if an object
        //  gets wrapped in an eye by eye1_replace), but... things get complicated quickly if we do that,
        //  and right now it works, it will just register more writes than needed.
        if(changed) {
            registerWrite(getChildKeyId(prop));
        }

        let wasDeleted = !(prop in obj);
        if(wasDeleted !== deleted) {
            registerOwnKeysWrite(eyeId);
        }

        if(wasDeleted !== deleted) {
            if(deleted) {
                lastKeyCountBounds--;
            } else {
                lastKeyCountBounds++;
            }
        }
    }

    function construct() {
        return new Proxy(obj as EyeType<T>, {
            get(target, propBadType, receiver) {
                if(propBadType === EyeLevelMark) return level;
                if(propBadType === EyeRawValue) return obj;
                if(propBadType === UnEyeMark) return true;
                if(propBadType === EyeId) return eyeId;

                if(typeof obj === "object" && obj instanceof Map && typeof propBadType === "string") {
                    return wrapMapFunctions(obj, propBadType, eyeId, onRead, onWrite);
                }
                if(typeof obj === "object" && Array.isArray(obj) && typeof propBadType === "string") {
                    let result = wrapArrayFunctions(
                        obj,
                        eye as unknown[],
                        propBadType,
                        arrayDeltaId,
                        () => {
                            registerWrite(getChildKeyId("length"));
                            registerOwnKeysWrite(eyeId);
                        }
                    );
                    if(result) {
                        return result;
                    }
                }

                function registerChangesAsReadDelta(fullReads: ReadDelta["fullReads"], changes: KeyDeltaChanges<unknown>): void {
                    // NOTE: fullReads is in the delta context, and registerDeltaReadAccess keys based on fullReads, and derived wraps it's code
                    //  in a delta context, so... we don't have to worry about messing up derived by calling register multiple times in one
                    //  derived, as each call will just wipe out the subsequent changes.

                    // NOTE: Because values are changed immediately (we don't isolate side-effects), we can do some nice things here.
                    //  For example:
                    /*
                            function example(this: Context) {
                                for(let key in this.lookup) {
                                    console.log(this.lookup[key]);
                                    delete this.lookup[key];
                                }
                            }
                        A purely functional system would evaluate this as a keys read on this.lookup, a read of every value
                            and then a write to every value.
                        However... we can cheat. Because we deleted the keys from the lookup we don't need to watch them anymore. Therefore,
                            we only need to incur a keys read on this.lookup (and the writes).
                        This works because the function is allowed to change state as it runs. This yields issues when
                            trying to isolate functions and test their output without changing state, as it may appear
                            that a function will read less values than it really does... but it makes writing this code much easier...
                        ALTHOUGH... with synchronous subscriptions we will self trigger... so... does that affect anything?
                    */

                    // NOTE: It may seem more efficient to calculate this all in finishRun... however... we want a derived to be able to trigger itself,
                    //  and if we delay the subscriptions to the end of the run, that won't be the case.

                    let delta: ReadDelta = {
                        fullReads,
                        readsAdded: new Set(),
                        readsRemoved: new Set(),
                    };

                    for(let key of changes.keys()) {
                        let pathHash = getChildKeyId(key);
                        // "in" works fine for arrays, so I see no reason to special case arrays.
                        //  It is different than a .length check for sparse arrays... which is maybe good? Or bad?
                        //      Maybe we should just throw errors if we ever see a sparse array?
                        if(key in obj) {
                            fullReads.add(pathHash);
                            delta.readsAdded.add(pathHash);
                        } else {
                            fullReads.delete(pathHash);
                            delta.readsRemoved.add(pathHash);
                        }
                    }

                    registerDeltaReadAccess(delta);
                }

                /*
                function registerArrayChangesAsReadDelta(fullReads: ReadDelta["fullReads"], changes: ArrayDelta): void {
                    let delta: ReadDelta = {
                        fullReads,
                        readsAdded: new Map(),
                        readsRemoved: new Map(),
                    };

                    // Uh... oh right, the size delta is all the matters. In terms of total keys accessed. Huh... kind of funny, but, meh...

                    changes.inserts;
                    changes.removes;

                    for(let key of changes.keys()) {
                        let path = getPathForChild(key as keyof T);
                        // "in" works fine for arrays, so I see no reason to special case arrays.
                        //  It is different than a .length check for sparse arrays... which is maybe good? Or bad?
                        //      Maybe we should just throw errors if we ever see a sparse array?
                        if(key in initialState) {
                            fullReads.set(path.pathHash, { path });
                            delta.readsRemoved.set(path.pathHash, path);
                        } else {
                            fullReads.delete(path.pathHash);
                            delta.readsAdded.set(path.pathHash, path);
                        }
                    }

                    registerDeltaReadAccess(delta);
                }
                */

                if(propBadType === lookupDelta) {
                    let deltaContext = DeltaContext.GetCurrent();
                    if(deltaContext) {
                        let state = deltaContext.GetOrAddState(lookupDeltaId, () => eyeDeltaStateConstructor(eye));
                        let { curChanges } = state;
                        return () => {
                            // We need to trigger reads of these values, VIA registerDeltaReadAccess, or else we are making untracked reads.
                            if(curChanges) {
                                registerChangesAsReadDelta(state.fullReads, curChanges.changes);
                            }
                            return curChanges?.changes;
                        };
                    }
                }
                if(propBadType === arrayDelta && Array.isArray(obj)) {
                    let deltaContext = DeltaContext.GetCurrent();
                    if(deltaContext) {
                        let state = deltaContext.GetOrAddState(arrayDeltaId, () => eyeArrayDeltaStateConstructor(obj));
                        let { curChanges } = state;
                        return () => {
                            if(curChanges) {
                                // TODO: Access the change in length indexes.
                                //  Of course, if the values are object and they access those, well then we run into the nested
                                //  derived problem, which will be slow (until we fix it).
                                registerKeysReadAccess(eyeId);
                                //Object.values(eye);
                                // TODO: Oh, right... while delta has the necessary state... reads will still need a full diff to find
                                //  removals, so... we should also pass values, that way further reads aren't needed.
                                // Or... we could just get into nested read deltas, and handle it with whatever technique we will use
                                //  to allow Array.map functions to run and isolate their state...
                                // Also... with maps we can probably simplify our childPath stuff, which would simplfiy a lot of this...
                                //  (such as right now we would need to keep track of paths for previous state). And after all, why are we
                                //  making unique keys per child key? I know about objects, but... idk... maybe every eye should
                                //  just have a unique name itself, and then have the paths of it's accessed use that unique id,
                                //  plus the key. And then... we can figure out debugging later, although maybe that isn't
                                //  even needed, we can just consider every eye an independent entity.
                                //  - And use Maps, so the eye is fixed to an object perfectly, with the possibility of untracked
                                //      accesses, sure, but with no way to lose the eye, or eye duplicates, etc.
                                /*
                                curChanges.changes.getDelta().removes
                                
                                registerDeltaReadAccess({ fullReads: state.fullReads, ...curChanges.readDelta });

                                let { readsAdded } = curChanges.readDelta;
                                addReadsDeltaToChildPaths(readsAdded);
                                */
                            }
                            return curChanges?.changes.getDelta();
                        };
                    }
                }

                if(typeof propBadType === "symbol") {
                    console.log(`Read symbol ${String(propBadType)}`);
                }

                let rawValue = Reflect.get(obj, propBadType, receiver);

                return onRead(propBadType, rawValue);
            },
            // Won't defineProperty get called anyway?
            //  I feel like defineProperty is getting called more than it should be... because of some bug in my code...
            /*
            set(target, propBadType, value, receiver) {
                // Spurious type error, this is by definition the correct way to call Reflect.set
                return (Reflect.set as any)(...arguments);
            },
            //*/
            deleteProperty(target, propBadType) {
                onWrite(propBadType, undefined, true);
                return (Reflect.deleteProperty as any)(...arguments);
            },
            has(target, propBadType) {
                if(propBadType === EyeLevelMark) return true;
                if(propBadType === EyeRawValue) return true;
                if(propBadType === EyeId) return true;
                if(propBadType === UnEyeMark) return false;
                if(propBadType === arrayDelta) return DeltaContext.GetCurrent() !== undefined;
                if(propBadType === lookupDelta) return DeltaContext.GetCurrent() !== undefined;

                onRead(propBadType, undefined);
                return (Reflect.has as any)(...arguments);
            },
            defineProperty(target, propBadType, descriptor) {
                onWrite(propBadType, descriptor.value, false);
                return (Reflect.defineProperty as any)(...arguments);
            },
            ownKeys(target) {
                registerKeysReadAccess(eyeId);
                if(obj instanceof Set) {
                    throw new Error(`TODO: Implement ownKeys for Set`);
                }
                if(obj instanceof Map) {
                    throw new Error(`TODO: Implement ownKeys for Map`);
                }
                let keys = Reflect.ownKeys(obj);
                lastKeyCountBounds = keys.length;
                return keys;
            },
            
            apply(targetBadType, thisArg, argumentsList) {
                let target = targetBadType as object|Function;
                // TODO: For 'incompatible receivers', hardcode an understanding of the function (in terms of reads/writes)
                //  here, and then apply with parentContext as the thisArg instead.
                if(typeof target === "function") {
                    let targetStr = String(target);
                    // If they are calling it, give them to real function, not the proxy.
                    if(EyeRawValue in target) {
                        target = (target as any)[EyeRawValue];
                        if(typeof target !== "function") {
                            throw new Error(`Internal error, proxy had a typeof function, but raw value has a type of ${typeof target}`);
                        }
                    }
                    let constRecursiveFunctions = [
                        "function toString() { [native code] }"
                    ];
                    if(constRecursiveFunctions.includes(targetStr)) {
                        // Unwrap functions that don't expose the this target, evaluating them completely raw.
                        if(canHaveChildren(thisArg) && EyeRawValue in thisArg) {
                            thisArg = (thisArg as any)[EyeRawValue];
                        }
                    }
                }

                let originalThisArg = thisArg;
                let rawThisArg = thisArg;
                if(canHaveChildren(thisArg) && EyeRawValue in thisArg) {
                    rawThisArg = (thisArg as any)[EyeRawValue];
                }

                let result = Reflect.apply(target as Function, thisArg, argumentsList);

                if(result === rawThisArg) {
                    result = originalThisArg;
                }

                return result;
            },

            getPrototypeOf(target) {
                return Reflect.getPrototypeOf(target);
            },
        });
    }
}