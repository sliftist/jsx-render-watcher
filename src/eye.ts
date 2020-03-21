import { registerReadAccess, registerWrite, registerKeysReadAccess, registerOwnKeysWrite } from "./accessEvents";
import { getRootKey, getChildPath } from "./path";
import { unreachable, canHaveChildren } from "./algorithms";
import { g } from "./misc";

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

let pathSeqNum = 0;

// NOTE: We don't support watching 

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
    let i = initialState as any;
    let niceNameTyped = niceName || i.name || i.constructor && i.constructor.name || "";
    let path: EyeTypes.Path2 = getRootKey(niceNameTyped, pathSeqNum++);
    return eyeInternal(initialState, path, level, true);
}

/** Eye is pure, it does not mutate underlying state (and so is stored as a replacement of the state) */
export function eye0_pure<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye0_pure, niceName);
}
/** Eye writes symbols to the root state (and may or may not be stored as a replacement of the state) */
export function eye1_root<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye1_root, niceName);
}
/** Eye writes symbols to the entire tree */
export function eye2_tree<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye2_tree, niceName);
}
/** Eye writes symbols to the root, and then replaces the entire tree with eyes (and writes symbols) */
export function eye3_replace<T extends object>(initialState: T, niceName?: string) {
    return eye(initialState, EyeLevel.eye3_replace, niceName);
}

(g as any).__eye_testIsEye = testIsEye;
export function testIsEye(obj: unknown) {
    return canHaveChildren(obj) && EyePath in obj;
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
        [key in PropertyKey]: EyeTypes.Path2
    } = Object.create(null);

    let childLevel = level;
    if(childLevel === EyeLevel.eye1_root) {
        childLevel = EyeLevel.eye0_pure;
    }

    let eye = construct();
    // Disconnect the result of construct, so our type isn't recursive.
    let eyeForReturn = eye as unknown;
    if(level >= EyeLevel.eye1_root) {
        (initialState as any)[eyeSymbol] = eye;
        (initialState as any)[WrappedInEye] = true;
    }

    return eye;



    function onRead(propBadType: PropertyKey) {
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
        let childPath = childPaths[prop] = childPaths[prop] || getChildPath(path, prop, pathSeqNum++);
        
        registerReadAccess(childPath);

        // TODO: Pass receiver?
        let rawValue = Reflect.get(initialState, prop);
        if(!canHaveChildren(rawValue) || UnEyeMark in rawValue) {
            // Any primitives can be returned immediately, as they won't (can't) have nested accesses
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

        // If the underlying eye is replaced from under us, then update the eye we use.
        //  (Could definitely happen if our state is accessed outside of an eye, which is supported).
        if(!(prop in childEyes) || existingEye && childEyes[prop] !== existingEye) {
            let childEye = existingEye || eyeInternal(rawValue, childPath, childLevel);
            childEyes[prop] = childEye;
        }

        // When eye3_replace, update the state value so it is always an eye, and always the correct eye.
        if(rawValue !== childEyes[prop] && level === EyeLevel.eye3_replace) {
            initialState[prop] = childEyes[prop] as any;
        }

        return childEyes[prop];
    }
    function onWrite(propBadType: PropertyKey, newValue: unknown, deleted: boolean) {

        let prop = propBadType as keyof T;

        let oldValue = initialState[prop];

        // If it hasn't been accessed we don't fire the write. Because the path is always a path we created,
        //  and so if it hasn't been accesses, no one could possibly be watching for the read.
        if(prop in childPaths) {
            // TODO: We COULD do some checks here to see if eye(oldValue) === newValue (which happens if an object
            //  gets wrapped in an eye by eye3_replace), but... things get complicated quickly if we do that,
            //  and right now it works, it will just register more writes than needed.
            if(newValue !== oldValue) {
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
    }

    function construct() {
        return new Proxy(initialState as EyeType<T>, {
            get(target, propBadType) {
                if(propBadType === EyeMark) return eyeForReturn;
                if(propBadType === EyePath) return path;
                if(propBadType === EyeRawValue) return initialState;
                if(propBadType === eyeSymbol) return eyeForReturn;
                if(propBadType === UnEyeMark) return true;
                if(typeof propBadType === "symbol") {
                    console.log(`Read symbol ${String(propBadType)}`);
                }
                return onRead(propBadType);
            },
            // Won't defineProperty get called anyway?
            //  I feel like defineProperty is getting called more than it should be... because of some bug in my code...
            /*
            set(target, propBadType, value, receiver) {
                let rawValue = (Reflect.get as any)(...arguments);
                // Only register the write if the set is actually changing the value.
                if(rawValue !== value) {
                    onWrite(propBadType);
                }

                // Spurious type error, this is by definition the correct way to call Reflect.set
                return (Reflect.set as any)(...arguments);
            },
            */
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

                onRead(propBadType);
                return (Reflect.has as any)(...arguments);
            },
            defineProperty(target, propBadType, descriptor) {
                onWrite(propBadType, descriptor.value, false);
                return (Reflect.defineProperty as any)(...arguments);
            },
            ownKeys(target) {
                registerKeysReadAccess(path);
                return Reflect.ownKeys(initialState);
            },
            
            apply(targetBadType, thisArg, argumentsList) {
                let target = targetBadType as object|Function;
                // TODO: For 'incompatible receivers', hardcode an understanding of the function (in terms of reads/writes)
                //  here, and then apply with parentContext as the thisArg instead.
                if(typeof target === "function" && String(target).endsWith("{ [native code] }")) {
                    throw new Error(`Implementation of native function '${target.name}' not supported. Calling of native functions may mutate your data without change tracking, and so it is disable for unsupported native functions.`);
                }
                return Reflect.apply(initialState as Function, thisArg, argumentsList);
            }
        });
    }
}