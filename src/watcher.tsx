import { watchAccesses } from "./accessEvents";
import { eye, Eye1_root, EyeType, eye1_root, eye0_pure, EyeLevel, EyePath } from "./eye";
import { getAccesses, watchPaths, AccessState, unwatchPaths } from "./getAccesses";
import { canHaveChildren } from "./algorithms";
import { getRootKey, pathFromArray } from "./path";

export const BoxedValueSymbol = Symbol("BoxedValueSymbol");
export const DisposeSymbol = Symbol("DisposeSymbol");

type ObserverThisContext = {
    forceUpdate: () => void
};


// TODO: A check if where we do our Promise.resolve(), to see if it infinitely loops, and in which case...
//  - Probably just log a message every 1 seconds saying that we are still looping. It should log fine, as we
//      are Promise.resolving, so the main loop shouldn't block? I think?

// NOTE: We don't accept any arguments, as this should act as a singleton, not accepting any arguments.
//  IF you want a function memoizer, wrap this with something that keeps a context per set of arguments.


export function derived<T extends unknown>(
    fnc: () => T,
    thisContextEyeLevel?: EyeLevel,
    niceName?: string
): T {
    let outputEye = eye0_pure({} as { [key in PropertyKey]: unknown }, niceName);

    let run!: typeof runRaw; 
    function runRaw(this: typeof context) {
        return fnc();
    }
    let context = {
        forceUpdate() {
            let output = run.call(context);
            function setRecursive(target: any, source: any) {
                for(let key in target) {
                    let sourceValue = source[key];
                    if(typeof source === "function") {
                        // TODO: I guess we could do this, by copying the function, and something... it will be a headache to implement though...
                        throw new Error(`Returning functions in watchers with outputEyeContext set isn't supported yet`);
                    }
                    if(canHaveChildren(sourceValue)) {
                        // TODO: Don't Object.create, instead cache the old raw object, and diff them.
                        target[key] = Object.create(null);
                        setRecursive(target[key], sourceValue);
                    } else {
                        target[key] = sourceValue;
                    }
                }
            }
            // TODO: Oh, uh... we need to cache the last output, so we can handle key deletion efficiently...
            //  Which makes me wonder if it should also be used to handle NOOPing equivalent writes too... because...
            //  the eye can't, because right now we are creating new objects. And... if we handle NOOPing equal writes,
            //  then... maybe the eye shouldn't? Although... I guess it isn't so much effort to do it also in the eye,
            //  it does a really barebones comparison.
            setRecursive(outputEye, output);
        }
    };
    run = derivedRaw(runRaw, outputEye[EyePath].pathHash, thisContextEyeLevel);
    context.forceUpdate();

    return outputEye as T;
}

export function derivedRaw<T extends unknown, This extends ObserverThisContext>(
    fnc: (this: This) => T,
    niceName?: string,
    thisContextEyeLevel?: EyeLevel,
): (this: This) => T {

    let path = pathFromArray([niceName || "", Math.random().toString(), Date.now().toString()]);

    let disposed = false;
    let pendingChange = false;

    return Object.assign(wrapper, {
        // todonext: call this in the componentDidUnmount call, from the decorator
        // TODO: It seems like if there is ever a reason to use Proxy.revocable, this is it.
        // TODO: Maybe put dispose in the eye instead?
        // TODO: Hook this up via an argument, like forceUpdate, but... something like 'addDisposeCallback'.
        [DisposeSymbol]: () => {
            disposed = true;
            unwatchPaths(path.pathHash);
        }
    });

    // TODO: Type check ReturnType, and if the type is a primitive, actually make it the correct { [BoxedValueSymbol] } type.
    function wrapper(this: This): ReturnType<typeof fnc> {
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
                output = fnc.apply(thisContext);
            }
        );
        watchPaths(accesses, onChanged, path.pathHash);
        return output;
    }
}