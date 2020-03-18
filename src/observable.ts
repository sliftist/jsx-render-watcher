import { registerReadAccess, registerWriteAccess, registerKeysReadAccess } from "./accessEvents";
import { getRootKey, getChildPath } from "./path";

export const ObservableMark = Symbol("ObservableMark");
export const UnObservableMark = Symbol("UnObservableMark");
export const ObservablePath = Symbol("ObservablePath");
export const ObservableRawValue = Symbol("ObservableRawValue");

export type ObservableType<T> = T & {
    [ObservableMark]: true,
    [ObservablePath]: Observ.Path2,
    [ObservableRawValue]: unknown,
};

/**
 * 
 * @param initialState 
 * @param pathOverride Overrides the base path used for properties inside this observable. Be careful, if this collides
 *              with other paths we will assume the collision was intentional, and weird things may happen.
 */
export function observable<T extends object>(
    initialState: T,
    path?: Observ.Path2,
    replaceKeysWithObservables?: boolean
): ObservableType<T> {
    path = path || getRootKey(Math.random() + "_" + Date.now());
    return observableInternal(initialState, path, undefined, replaceKeysWithObservables || false);
}

function observableInternal<T extends object>(
    initialState: T,
    path: Observ.Path2,
    parentContext: object|undefined,
    replaceKeysWithObservables: boolean
): ObservableType<T> {
    // TODO: If the key is in the prototype, then we shouldn't watch the prototype, as it is probably (has to be?)
    //  a function.
    // TODO: Warnings if they use __proto__?
    // TODO: Maybe prototype support, so instanceof and stuff like that works?

    // TODO: Set and Map support.
    //  - We want to do this in apply(), I believe.

    let children: {
        [key in PropertyKey]: {
            observable: ObservableType<object>;
            path: Observ.Path2;
        }
    } = Object.create(null);


    function onRead(propBadType: PropertyKey) {
        let prop = propBadType as keyof T;
        // NOTE: We don't store this in childPaths, as storing all paths in childPaths will cause a memory leak.
        //  We only store the paths that are currently inside of our state, to avoid the memory leak.
        let childPath = prop in children ? children[prop].path : getChildPath(path, prop);
        registerReadAccess(childPath);

        // TODO: Pass receiver?
        let rawValue = Reflect.get(initialState, prop);
        if(typeof rawValue !== "object" && typeof rawValue !== "function" || rawValue === null || UnObservableMark in rawValue) {
            // Any primitives can be returned immediately, as they won't (can't) have nested accesses
            return rawValue;
        }

        if(!(prop in children)) {
            let childObservable = observableInternal(rawValue, childPath, initialState, replaceKeysWithObservables);
            children[prop] = {
                observable: childObservable,
                path: childPath,
            };
        }

        if(replaceKeysWithObservables) {
            initialState[prop] = children[prop].observable as any;
        }

        return children[prop].observable;
    }
    function onWrite(propBadType: PropertyKey) {
        let prop = propBadType as keyof T;
        let childPath = prop in children ? children[prop].path : getChildPath(path, prop);
        registerWriteAccess(childPath);
        return childPath;
    }

    return new Proxy(initialState as ObservableType<T>, {
        get(target, propBadType) {
            if(propBadType === ObservableMark) return true;
            if(propBadType === ObservablePath) return path;
            if(propBadType === ObservableRawValue) return initialState;
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
            // Only register the write if we are actually deleting something
            if(propBadType in target) {
                onWrite(propBadType);
            }
            let prop = propBadType as keyof typeof target;
            delete children[prop];
            return (Reflect.deleteProperty as any)(...arguments);
        },
        has(target, propBadType) {
            if(propBadType === ObservableMark) return true;
            onRead(propBadType);
            return (Reflect.has as any)(...arguments);
        },
        defineProperty(target, propBadType, descriptor) {
            let rawValue = (Reflect.get as any)(...arguments);
            if(rawValue !== descriptor.value) {
                onWrite(propBadType);
            }
            return (Reflect.defineProperty as any)(...arguments);
        },
        ownKeys(target) {
            registerKeysReadAccess(path);
            return Reflect.ownKeys(target);
        },
        apply(target, thisArg, argumentsList) {
            // TODO: For 'incompatible receivers', hardcode an understanding of the function (in terms of reads/writes)
            //  here, and then apply with parentContext as the thisArg instead.
            return Reflect.apply(target as Function, thisArg, argumentsList);
        }
    });
}