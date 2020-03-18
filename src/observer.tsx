import { watchAccesses } from "./accessEvents";
import { observable } from "./observable";
import { getAccesses, watchPaths, AccessState, unwatchPaths } from "./getAccesses";

export const BoxedValueSymbol = Symbol("BoxedValueSymbol");
export const DisposeSymbol = Symbol("DisposeSymbol");

type ObserverThisContext = {
    forceUpdate: () => void
};

// TODO: A check if where we do our Promise.resolve(), to see if it infinitely loops, and in which case...
//  - Probably just log a message every 1 seconds saying that we are still looping. It should log fine, as we
//      are Promise.resolving, so the main loop shouldn't block? I think?

export function observer<T extends unknown, This extends ObserverThisContext>(
    fnc: (this: This, ...args: any[]) => T,
    makeOutputObservable?: boolean
) {
    let value = observable({} as { [key in PropertyKey]: unknown });

    let disposed = false;
    let pendingChange = false;

    return Object.assign(wrapper, {
        [DisposeSymbol]: () => {
            disposed = true;
            unwatchPaths(value);
        }
    });

    // TODO: Type check ReturnType, and if the type is a primitive, actually make it the correct { [BoxedValueSymbol] } type.
    function wrapper(this: This, ...args: any[]): ReturnType<typeof fnc> {
        if(disposed) return null as any;

        let thisContext = this;
        function onChanged(path: Observ.Path2) {
            if(pendingChange) return;
            pendingChange = true;
            Promise.resolve().then(() => {
                pendingChange = false;
                thisContext.forceUpdate();
            });
        }

        let output!: ReturnType<typeof fnc>;
        let accesses = getAccesses(
            () => {
                output = fnc.apply(this, args);
            },
            value
        );
        watchPaths(accesses, onChanged, value);
        if(!makeOutputObservable) {
            return output;
        } else {
            if(typeof output !== "object" || output === null) {
                for(let key of Object.keys(value)) {
                    delete value[key];
                }
                value[BoxedValueSymbol as any] = output;
            } else {
                for(let key of Object.keys(value)) {
                    delete value[key];
                }
                for(let key in output) {
                    value[key] = (output as { [key in PropertyKey]: unknown })[key];
                }
            }
            return value as ReturnType<typeof fnc>;
        }
    }
}