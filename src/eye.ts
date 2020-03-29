import { registerReadAccess, registerWrite, registerKeysReadAccess, registerOwnKeysWrite } from "./accessEvents";
import { getRootKey, getChildPath, getParentPath } from "./path";
import { unreachable, canHaveChildren } from "./algorithms";
import { g } from "./misc";
import { DeltaState, lookupDelta, DeltaContext, DeltaStateId, DeltaChanges } from "./delta";

/** Returned from eyes, to indicate what they are. */
export const EyeMark = Symbol("EyeMark");
/** Prevents an object's children from being watched by eyes. */
export const UnEyeMark = Symbol("UnEyeMark");
export const EyePath = Symbol("EyePath");
export const EyeRawValue = Symbol("EyeRawValue");

export const Eye0_pure = Symbol("Eye0_pure");
export const Eye1_root = Symbol("Eye1_root");
export const Eye2_tree = Symbol("Eye2_tree");
export const Eye3_replace = Symbol("Eye3_replace");
/** Set if we are an object which has been wrapped by an eye. */
export const WrappedInEye = Symbol("WrappedInEye");

export const GetLastKeyCountBoundsSymbol = Symbol("GetLastKeyCountBoundsSymbol");

const EyeOnWrite = Symbol("EyeOnWrite");
const EyeOnRead = Symbol("EyeOnRead");


export enum EyeLevel {
    eye0_pure = 0,
    eye1_root = 1,
    eye2_tree = 2,
    eye3_replace = 3,
};

let levelToSymbol = {
    [EyeLevel.eye0_pure]: Eye0_pure,
    [EyeLevel.eye1_root]: Eye1_root,
    [EyeLevel.eye2_tree]: Eye2_tree,
    [EyeLevel.eye3_replace]: Eye3_replace,
};

export type EyeType<T> = T & {
    [EyeMark]: true;
    [EyePath]: EyeTypes.Path2;
    [EyeRawValue]: unknown;
};

let pathSeqNum = ~~(Math.random() * 1000);
export function GetUniqueRootPath(name?: string) {
    return getRootKey([name || "", pathSeqNum++]);
}

// NOTE: We don't support watching 

type EyeConfig = { singleton?: boolean };

let eyeSingletons: { [niceName: string]: true } = Object.create(null);

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
    niceName?: string,
    config?: EyeConfig
): EyeType<T> {
    if(config?.singleton && niceName) {
        if(niceName in eyeSingletons) {
            throw new Error(`Eye is not a singleton. Found another instance with the same name, ${niceName}`);
        }
    }
    let i = initialState as any;
    let niceNameComplete = niceName || i.name || i.constructor && i.constructor.name || "";
    let path: EyeTypes.Path2 = GetUniqueRootPath(niceNameComplete);
    if(config?.singleton && niceName) {
        path = getRootKey(niceName);
    }
    return eyeInternal(initialState, path, level, true);
}

/** Eye is pure, it does not mutate underlying state (and so is stored as a replacement of the state) */
export function eye0_pure<T extends object>(initialState: T, niceName?: string, config?: EyeConfig) {
    return eye(initialState, EyeLevel.eye0_pure, niceName, config);
}
/** Eye writes symbols to the root state (and may or may not be stored as a replacement of the state) */
export function eye1_root<T extends object>(initialState: T, niceName?: string, config?: EyeConfig) {
    return eye(initialState, EyeLevel.eye1_root, niceName, config);
}
/** Eye writes symbols to the entire tree */
export function eye2_tree<T extends object>(initialState: T, niceName?: string, config?: EyeConfig) {
    return eye(initialState, EyeLevel.eye2_tree, niceName, config);
}
/** Eye writes symbols to the root, and then replaces the entire tree with eyes (and writes symbols) */
export function eye3_replace<T extends object>(initialState: T, niceName?: string, config?: EyeConfig) {
    return eye(initialState, EyeLevel.eye3_replace, niceName, config);
}

(g as any).__eye_testIsEye = testIsEye;
export function testIsEye(obj: unknown) {
    return canHaveChildren(obj) && EyePath in obj;
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
interface EyeDeltaState extends DeltaState {
    curChanges: DeltaChanges<unknown>|undefined;
    pendingChanges: DeltaChanges<unknown>;
}
function eyeDeltaStateConstructor(lookup: { [key: string]: unknown }): EyeDeltaState {
    let state: EyeDeltaState = {
        curChanges: undefined,
        pendingChanges: new Map(),
    };
    for(let key in lookup) {
        addChange(key, undefined, lookup[key], state.pendingChanges);
    }
    return state;
}
function createId() {
    let deltaId: DeltaStateId<EyeDeltaState> = {
        startRun(state) {
            if(state.curChanges) throw new Error(`Internal error, startRun called before finishRun called`);
            state.curChanges = state.pendingChanges;
            // All the changes that happen after a run starts, until the next run starts, should be queued for the next
            //  run. It must be done in startRun and not finishRun in case a run modifies it's own state, and therefore has to rerun.
            state.pendingChanges = new Map();
        },
        finishRun(state) {
            state.curChanges = undefined;
        }
    }
    return deltaId;
}
/** Should be called if the value changes, OR if it is added, OR if it is deleted */
function onKeyChange(key: string, prevValue: unknown, newValue: unknown, id: DeltaStateId<EyeDeltaState>) {
    let states = DeltaContext.GetAllStates(id);
    for(let state of states) {
        if(state.curChanges) {
            addChange(key, prevValue, newValue, state.curChanges);
        }
        addChange(key, prevValue, newValue, state.pendingChanges);
    }
}
function addChange(key: string, prevValue: unknown, newValue: unknown, delta: DeltaChanges<unknown>) {
    let prevDelta = delta.get(key);
    if(!prevDelta) {
        delta.set(key, { prevValue, newValue });
    } else {
        // Keep the old previous value, as previous is in reference to the previous run, not the previous set.
        prevDelta.newValue = newValue;
    }
}

function eyeInternal<T extends object>(
    initialState: T,
    path: EyeTypes.Path2,
    level: EyeLevel,
    isRoot?: boolean
): EyeType<T> {
    if(!canHaveChildren(initialState)) {
        throw new Error(`Unsupported eye initial state, must be able to have children, was typeof ${typeof initialState}`);
    }

    let lastKeyCountBounds = 0;

    // TODO: If the key is in the prototype, then we shouldn't watch the prototype, as it is probably (has to be?)
    //  a function.
    // TODO: Warnings if they use __proto__?
    // TODO: Maybe prototype support, so instanceof and stuff like that works?

    // TODO: Set and Map support.
    //  - We want to do this in apply(), I believe.

    let eyeSymbol = levelToSymbol[level];
    if(eyeSymbol in initialState) {
        return (initialState as any)[eyeSymbol];
    }

    let childEyes: {
        [key in PropertyKey]: EyeType<object>;
    } = Object.create(null);
    let childPaths: {
        [key in PropertyKey]: EyeTypes.Path2;
    } = Object.create(null);

    let childLevel = level;
    if(childLevel === EyeLevel.eye1_root) {
        childLevel = EyeLevel.eye0_pure;
    }

    let eye = construct();
    // Disconnect the result of construct, so our type isn't recursive.
    let eyeForReturn = eye as unknown;
    if(level >= EyeLevel.eye1_root) {
        if(Object.isExtensible(initialState)) {
            // We do what we can do, if it isn't extensible, we can't be adding symbols to it...
            (initialState as any)[eyeSymbol] = eye;
            (initialState as any)[WrappedInEye] = true;
        }
    }

    let deltaId = createId();

    return eye;

    function onRead(propBadType: PropertyKey, rawValue: unknown) {
        let prop = propBadType as keyof T;
        
        // NOTE: This can cause a memory leak if many keys which are not in the state
        //  are accessed (and then never deleted, which is likely because if they are not in the state it is likely they
        //  won't be deleted...)
        // NOTE: This has to set the childPath, even if the path doesn't exist, because of the sequence number (otherwise
        //  accessing a value that doesn't exist, that later exists, won't trigger the same sequence number).
        //  - HOWEVER, this is required to support the usecase of an eye of a large object being created,
        //      and then having nested objects inside that being passed to other objects, and then the parents of those objects
        //      being changed to different objects. As in, because the parent object changes we need to create a new path
        //      or else we will trigger these now unrelated objects.
        let childPath = childPaths[prop] = childPaths[prop] || getChildPath(path, [prop, pathSeqNum++]);
        
        registerReadAccess(childPath);

        let descriptor = Object.getOwnPropertyDescriptor(initialState, propBadType);
        if(descriptor) {
            if(!descriptor.writable && !descriptor.configurable) {
                // Otherwise an error is thrown, like:
                //  "TypeError: 'get' on proxy: property 'prototype' is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value (expected '[object Array]' but got '[object Object]')"
                // TODO: This isn't safe, because non-writable is shallow, so it could have nested properties that are writable. So... we should
                //  iterate deeper into rawValue to try to find the first writable or configurable properties and replace those with proxies?
                //  (if we are eye3_replace)
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
            //  for functions we should probably just not touch them.
            return rawValue;
        }

        // rawValue is NOT a primitive, so it might be an eye...

        // NOTE: I think technically we don't need any of this eye checking. However without it we could end up with a lot
        //  of extra read accesses, that don't really matter.
        //  As in...
        //      let a = eye({ b: { c: 5 } });
        //      let x = eye({ y: a })
        //      x.y.b
        //  Without this code the above snippet would result in accesses on:
        //      x
        //      x.y
        //      x.y.b
        //      a.b
        //      x.y.b.c
        //      a.b.c
        //  Which is unneeded, because for x.y.b to not equal a.b, there would need to be a write to x.y, which is watched anyway!
        //  With this code, this reduces to:
        //      x
        //      x.y
        //      a.b
        //      a.b.c
        let existingEye: EyeType<unknown>|undefined;
        if(EyeMark in rawValue) {
            existingEye = (rawValue as any);
        }
        else if(WrappedInEye in rawValue) {
            // Prefer to use the highest level eye
            if(Eye3_replace in rawValue) {
                existingEye = (rawValue as any)[Eye3_replace];
            } else if(Eye2_tree in rawValue) {
                existingEye = (rawValue as any)[Eye2_tree];
            } else if(Eye1_root in rawValue) {
                existingEye = (rawValue as any)[Eye1_root];
            }
            // Eye0_pure is not put in state, so we don't need to check for it
        }

        if(prop in childEyes) {
            existingEye = childEyes[prop];
        }

        if(existingEye && existingEye[EyeRawValue] !== unwrapEye(rawValue)) {
            // If the eye exists, but doesn't match the underlying object, then the object has changed
            //  and so we need to create a new eye (as reads on the old eye should only change if the old
            //  object has changed).
            //  - This only happens if someone changed the object outside of an eye.
            existingEye = undefined;
        }

        // If the underlying eye is replaced from under us, then update the eye we use.
        //  (Could definitely happen if our state is accessed outside of an eye, which is supported).
        if(!existingEye || existingEye && childEyes[prop] !== existingEye) {
            let childEye = existingEye || eyeInternal(rawValue, childPath, childLevel);
            childEyes[prop] = childEye;
        }

        // When eye3_replace, update the state value so it is always an eye, and always the correct eye.
        if(rawValue !== childEyes[prop] && level === EyeLevel.eye3_replace) {
            if(descriptor?.writable) {
                initialState[prop] = childEyes[prop] as any;
            }
        }

        return childEyes[prop];
    }
    function onWrite(propBadType: PropertyKey, newValue: unknown, deleted: boolean) {

        let prop = propBadType as keyof T;

        let oldValue = initialState[prop];

        if(typeof propBadType !== "symbol") {
            onKeyChange(String(propBadType), oldValue, newValue, deltaId);
        }

        // If it hasn't been accessed we don't fire the write. Because the path is always a path we created,
        //  and so if it hasn't been accesses, no one could possibly be watching for the read.
        if(prop in childPaths) {
            let changed = newValue !== oldValue;
            // Array.length is implicitly defined based on the Array properties (see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array#Relationship_between_length_and_numerical_properties),
            //  and while it does trigger a proxy change notification, the actual value changes first.
            // So for Array.length, we always trigger a change.
            if(Object.getPrototypeOf(initialState) === Array.prototype && prop === "length") {
                changed = true;
            }

            // TODO: We COULD do some checks here to see if eye(oldValue) === newValue (which happens if an object
            //  gets wrapped in an eye by eye3_replace), but... things get complicated quickly if we do that,
            //  and right now it works, it will just register more writes than needed.
            if(changed) {
                registerWrite(childPaths[prop]);

                if(prop in childEyes) {
                    // The old eye has been detached, and will be created from the new object when it is accessed again.
                    //  We registered the write, so any watchers will run appropriately.
                    delete childEyes[prop];
                    delete childPaths[prop];
                }
            }
        }

        let wasDeleted = !(prop in initialState);
        if(wasDeleted !== deleted) {
            registerOwnKeysWrite(path, prop, deleted ? "remove" : "add");
        }
        if(deleted) {
            delete childEyes[prop];
            delete childPaths[prop];
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
        return new Proxy(initialState as EyeType<T>, {
            get(target, propBadType, receiver) {
                if(propBadType === EyeMark) return eyeForReturn;
                if(propBadType === EyePath) return path;
                if(propBadType === EyeRawValue) return initialState;
                if(propBadType === eyeSymbol) return eyeForReturn;
                if(propBadType === UnEyeMark) return true;
                if(propBadType === GetLastKeyCountBoundsSymbol) {
                    return lastKeyCountBounds;
                }
                if(propBadType === EyeOnRead) return onRead;
                if(propBadType === EyeOnWrite) return onWrite;
                if(typeof propBadType === "symbol") {
                    console.log(`Read symbol ${String(propBadType)}`);
                }

                if(initialState instanceof Map) {
                    function validateMapKey(key: unknown): key is PropertyKey {
                        if(typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
                            return true;
                        } else {
                            // TODO: We can support this on the eye levels that allow object mutation, by adding our own key to the object in a symbol property.
                            throw new Error(`Wrapping Map that uses non primitive keys is not supported yet.`);
                        }
                    }
                    if(propBadType === "has") {
                        return function mapHas(this: Map<unknown, unknown>, key: unknown) {
                            if(!validateMapKey(key)) return;
                            onRead(key, undefined);
                            return initialState.has(key);
                        };
                    }
                    if(propBadType === "delete") {
                        return function mapDelete(this: Map<unknown, unknown>, key: unknown) {
                            if(!validateMapKey(key)) return;
                            onRead(key, undefined);
                            onWrite(key, undefined, true);
                            return initialState.delete(key);
                        };
                    }
                    if(propBadType === "get") {
                        return function mapGet(this: Map<unknown, unknown>, key: unknown) {
                            if(!validateMapKey(key)) return;
                            let result = initialState.get(key);
                            return onRead(key, result);
                        };
                    }
                    if(propBadType === "set") {
                        return function mapSet(this: Map<unknown, unknown>, key: unknown, value: unknown) {
                            if(!validateMapKey(key)) return;
                            initialState.set(key, value);
                            return eye;
                        };
                    }
                    if(propBadType === "entries") {
                        return function mapEntries(this: Map<unknown, unknown>) {
                            registerKeysReadAccess(path);
                            let results: unknown[] = [];
                            for(let [key, value] of initialState.entries()) {
                                if(!validateMapKey(key)) return;
                                value = onRead(key, value);
                                results.push([key, value]);
                            }
                            return results;
                        };
                    }
                    if(propBadType === "keys") {
                        return function mapKeys(this: Map<unknown, unknown>) {
                            registerKeysReadAccess(path);
                            let results: unknown[] = [];
                            for(let key of initialState.keys()) {
                                if(!validateMapKey(key)) return;
                                onRead(key, undefined);
                                results.push(key);
                            }
                            return results;
                        };
                    }
                    if(propBadType === "values") {
                        return function mapValues(this: Map<unknown, unknown>) {
                            registerKeysReadAccess(path);
                            let results: unknown[] = [];
                            for(let [key, value] of initialState.entries()) {
                                value = onRead(key, value);
                                results.push(value);
                            }
                            return results;
                        };
                    }
                    if(propBadType === "clear") {
                        return function mapValues(this: Map<unknown, unknown>) {
                            registerKeysReadAccess(path);
                            for(let key of initialState.keys()) {
                                onWrite(key, undefined, true);
                            }
                            initialState.clear();
                        };
                    }
                    // forEach
                }

                if(propBadType === lookupDelta) {
                    let deltaContext = DeltaContext.GetCurrent();
                    if(deltaContext) {
                        let state = deltaContext.GetOrAddState(deltaId, () => eyeDeltaStateConstructor(eye));
                        return () => ({ keysChanged: state.curChanges });
                    }
                }

                let rawValue = Reflect.get(initialState, propBadType, receiver);

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
                let prop = propBadType as keyof typeof initialState;
                delete childEyes[prop];
                return (Reflect.deleteProperty as any)(...arguments);
            },
            has(target, propBadType) {
                if(propBadType === EyeMark) return true;
                if(propBadType === EyePath) return true;
                if(propBadType === EyeRawValue) return true;
                if(propBadType === eyeSymbol) return true;
                if(propBadType === UnEyeMark) return false;
                if(propBadType === GetLastKeyCountBoundsSymbol) return true;
                if(propBadType === EyeOnRead) return true;
                if(propBadType === EyeOnWrite) return true;
                if(propBadType === lookupDelta) return DeltaContext.GetCurrent() !== undefined;

                onRead(propBadType, undefined);
                return (Reflect.has as any)(...arguments);
            },
            defineProperty(target, propBadType, descriptor) {
                onWrite(propBadType, descriptor.value, false);
                return (Reflect.defineProperty as any)(...arguments);
            },
            ownKeys(target) {
                registerKeysReadAccess(path);
                if(initialState instanceof Set) {
                    throw new Error(`TODO: Implement ownKeys for Set`);
                }
                if(initialState instanceof Map) {
                    throw new Error(`TODO: Implement ownKeys for Map`);
                }
                let keys = Reflect.ownKeys(initialState);
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

                {
                    if(canHaveChildren(thisArg) && EyeRawValue in thisArg) {

                        let onReadBase: typeof onRead = (thisArg as any)[EyeOnRead];
                        let onWriteBase: typeof onWrite = (thisArg as any)[EyeOnWrite];

                        if(rawThisArg instanceof Map) {

                            //todonext;
                            // Oh, right, we need to wrap the outputs in proxies too (sometimes). So... we need to actually map the functions,
                            //  instead of just watching them be called...
                            /*

                            if(target === Map.prototype.has || target === Map.prototype.delete || target === Map.prototype.get) {
                                onReadBase(argumentsList[0]);
                                thisArg = rawThisArg;
                            }
                            if(target === Map.prototype.delete) {
                                onWriteBase(argumentsList[0], undefined, true);
                                thisArg = rawThisArg;
                            }
                            if(target === Map.prototype.set) {
                                onWriteBase(argumentsList[0], argumentsList[1], false);
                                thisArg = rawThisArg;
                            }
                            if(target === Map.prototype.entries
                                || target === Map.prototype.keys
                                || target === Map.prototype.values
                            ) {
                                let parentPath = getParentPath(path);
                                registerKeysReadAccess(parentPath);
                                for(let key of rawThisArg.keys()) {
                                    onRead(key);
                                }
                                thisArg = rawThisArg;
                            }
                            if(target === Map.prototype.clear
                                || target === Map.prototype.forEach
                            ) {
                                debugger;
                            }
                            */
                        }
                    }
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