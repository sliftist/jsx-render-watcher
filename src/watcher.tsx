import { watchAccesses } from "./accessEvents";
import { eye, Eye1_root, EyeType, eye1_root, eye0_pure, EyeLevel } from "./eye";
import { getAccesses, watchPaths, AccessState, unwatchPaths } from "./getAccesses";
import { canHaveChildren } from "./algorithms";

export const BoxedValueSymbol = Symbol("BoxedValueSymbol");
export const DisposeSymbol = Symbol("DisposeSymbol");

type ObserverThisContext = {
    forceUpdate: () => void
};


// TODO: A check if where we do our Promise.resolve(), to see if it infinitely loops, and in which case...
//  - Probably just log a message every 1 seconds saying that we are still looping. It should log fine, as we
//      are Promise.resolving, so the main loop shouldn't block? I think?

// TODO: Consider adding a parameter that also automatically wraps all parameters in observables?

export function watcher<T extends unknown, This extends ObserverThisContext>(
    fnc: (this: This, ...args: any[]) => T,
    thisContextEyeLevel?: EyeLevel,
    makeOutputEye?: boolean,
) {
    let outputEye = eye0_pure({} as { [key in PropertyKey]: unknown });

    let disposed = false;
    let pendingChange = false;

    return Object.assign(wrapper, {
        // todonext: call this in the componentDidUnmount call, from the decorator
        [DisposeSymbol]: () => {
            disposed = true;
            unwatchPaths(outputEye);
        }
    });

    // TODO: Type check ReturnType, and if the type is a primitive, actually make it the correct { [BoxedValueSymbol] } type.
    function wrapper(this: This, ...args: any[]): ReturnType<typeof fnc> {
        if(disposed) return null as any;

        const onChanged = (path: EyeTypes.Path2) => {
            if(pendingChange) return;
            pendingChange = true;
            Promise.resolve().then(() => {
                pendingChange = false;
                this.forceUpdate();
            });
        };

        let thisContext = this;
        if(thisContextEyeLevel !== undefined && canHaveChildren(this)) {
            thisContext = eye(this, thisContextEyeLevel);
        }

        let output!: ReturnType<typeof fnc>;
        let accesses = getAccesses(
            () => {
                output = fnc.apply(thisContext, args);
            },
            outputEye
        );
        watchPaths(accesses, onChanged, outputEye);
        if(!makeOutputEye) {
            return output;
        } else {
            function setRecursive(target: any, source: any) {
                for(let key in target) {
                    let sourceValue = source[key];
                    if(typeof source === "function") {
                        // TODO: I guess we could do this, by copying the function, and something... it will be a headache to implement though...
                        throw new Error(`Returning functions in watchers with makeOutputEye set isn't supported yet`);
                    }
                    if(canHaveChildren(sourceValue)) {
                        target[key] = Object.create(null);
                        setRecursive(target[key], sourceValue);
                    } else {
                        target[key] = sourceValue;
                    }
                }
            }
            setRecursive(outputEye, output);
            return outputEye as ReturnType<typeof fnc>;
        }
    }
}