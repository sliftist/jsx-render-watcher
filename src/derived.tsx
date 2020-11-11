import { watchAccesses, getReads, ReadDelta, registerDeltaReadAccess, registerKeysReadAccess } from "./accessEvents";
import { eye, EyeType, eye0_pure, EyeLevel, EyeId, isEye } from "./eye";
import { watchPaths, AccessState, unwatchPaths, watchPathsDelta, PathDelta } from "./getAccesses";
import { canHaveChildren, insertIntoListMapped } from "./lib/algorithms";
import { getRootKey, pathFromArray } from "./lib/path";
import { exposeDebugLookup } from "./debugUtils/exposeDebug";
import { getPathQuery } from "./debugUtils/searcher";
import { createNewIdentifier } from "./identifer";
import { DeltaContext, DeltaState, DeltaStateId } from "./delta/DeltaContext";
import { UnionUndefined as thisIsAVariableDeclaration } from "./lib/misc";
import { derivedTotalReads } from "./derivedStats";

export const BoxedValueSymbol = Symbol("BoxedValueSymbol");
export const DisposeSymbol = Symbol("DisposeSymbol");


const DerivedIdSymbol = Symbol("DerivedIdSymbol");


type ObserverThisContext = {
    forceUpdate: () => void;
    // The order of these strings (< is sooner) determines the order at which forceUpdate is called...
    //  undefined is last.
    updateOrder?: string;
};

// TODO: This should probably handle callback deduping itself, so we don't queue a callback twice...
let scheduledCallbacks: {callback: () => void; order: string|undefined}[] | undefined = undefined;
function scheduleCallback(this: any, callback: () => void, order: string|undefined = undefined) {
    let ourCallbacksObject: object|undefined;
    if(!scheduledCallbacks) {
        ourCallbacksObject = scheduledCallbacks = [];
        //let callbacks = scheduledCallbacks;
        /*
        void Promise.resolve().then(() => {
            scheduledCallbacks = undefined;
            for(let callback of callbacks) {
                callback.callback();
            }

            if(scheduledCallbacks === undefined && onDerivedsSettledObj) {
                // eslint-disable-next-line @typescript-eslint/unbound-method
                let { resolve } = onDerivedsSettledObj;
                onDerivedsSettledObj = undefined;
                resolve();
            }
        });
        */
    }
    insertIntoListMapped(scheduledCallbacks, { callback, order }, a => a.order, (a, b) => {
        if(a === undefined && b === undefined) return 0;
        if(a === undefined) return +1;
        if(b === undefined) return -1;
        return (
            a < b ? -1 :
            a > b ? +1
            : 0
        );
    }, "add");
    if(ourCallbacksObject) {
        Promise.resolve().then(() => {
            handleCallbacksNow(ourCallbacksObject);
        }, (e) => { throw e });
    }
}

function handleCallbacksNow(callbacksObject: object|undefined) {
    if(!scheduledCallbacks || callbacksObject !== scheduledCallbacks) return;
    // NOTE: Handling callbacks at the root like this means although in relation to each other our callbacks are handled as
    //  expected, we may trigger external callbacks in a strange order (if they further trigger events, which are
    //  handled synchronously).
    try {
        while(true) {
            let callback = scheduledCallbacks.shift();
            if(!callback) break;
            callback.callback();
        }
    } finally {
        scheduledCallbacks = undefined;
    }
}

export function settleDerivedsNow() {
    handleCallbacksNow(scheduledCallbacks);
}

const derivedEyeSymbol = Symbol("derivedEyeSymbol");

// TODO: A check if where we do our Promise.resolve(), to see if it infinitely loops, and in which case...
//  - Probably just log a message every 1 seconds saying that we are still looping. It should log fine, as we
//      are Promise.resolving, so the main loop shouldn't block? I think?

// NOTE: We don't accept any arguments, as this should act as a singleton, not accepting any arguments.
//  IF you want a function memoizer, wrap this with something that keeps a context per set of arguments.

/** Output from this derived should only occur in the form of setting eyes in other scopes or accessing values
 *      in the result (which is wrapped in an eye). If this derived statement has side-effects that write
 *      to values in an enclosing scope that are not wrapped in an eye, then they won't be tracked, and so
 *      changes may be lost!
 *      Ex, DON'T DO THIS:
            derived(() => {
                let x;
                derived(() => {
                    x = eyeArray.reduce((a, b) => a + b, 0);
                });
                console.log(x);
            })
        Instead, at LEAST do:
            derived(() => {
                let xHolder = eye({value: 0});
                derived(() => {
                    xHolder.value = eyeArray.reduce((a, b) => a + b, 0);
                });
                console.log(xHolder.value);
            })
 */
export function derived<T extends unknown>(
    fnc: () => T,
    niceName?: string,
    thisContextEyeLevel?: EyeLevel,
    /** Indicates that the derived this is currently running under (if any) is the parent, dispose
     *      should be called when the derived is no longer used in a run of the parent OR when the
     *      parent is disposed.
     *  This is USUALLY the case, however, there may be cases when you want to raise the derived to
     *      a global state, in which case you should set attachToParent to false, and then manually
     *      call your dispose function.
     *  "weak" means that dispose won't be called when unused by the parent, BUT will be called when
     *      the parent is disposed
     */
    attachToParent: boolean|"weak" = false,
    disposeCallback?: () => void
) {
    // We notify our parents of important updates, because we return the result as an eye. If the parent doesn't
    //  utilize the output eye (or parts of it), then it doesn't need to know when we change, which is fine.

    /*
    if(attachToParent && derivedId) {
        let parent = getParentDerived();
        if(parent) {
            let prevChildState = parent.children.get(derivedId);
            if(prevChildState && derivedEyeSymbol in prevChildState) {
                return (prevChildState as any)[derivedEyeSymbol];
            }
        }
    }
    */

    let outputRaw: T|undefined = undefined;
    let outputEye = eye0_pure(Object.create(null) as { [key in PropertyKey]: unknown }, niceName);
    let id = outputEye[EyeId];

    let run!: ReturnType<typeof derivedRaw>; 
    function runRaw(this: ObserverThisContext) {
        return fnc.call(this);
    }
    let context = {
        name: niceName || fnc.name,
        forceUpdate() {
            let output = run.call(context);
            function setRecursive(target: any, source: any) {
                for(let key in source) {
                    let sourceValue = source[key];
                    if(typeof source === "function") {
                        // TODO: I guess we could do this, by copying the function, and something... it will be a headache to implement though...
                        throw new Error(`Returning functions in watchers with outputEyeContext set isn't supported yet`);
                    }
                    if(canHaveChildren(sourceValue)) {
                        if(isEye(sourceValue)) {
                            // Don't unwrap eyes, they are likely cached elsewhere anywhere, so unwrapping them will be inefficient.
                            target[key] = sourceValue;
                        } else {
                            // TODO: Don't Object.create, instead cache the old raw object, and diff them.
                            target[key] = Object.create(null);
                            setRecursive(target[key], sourceValue);
                        }
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
    run = derivedRaw(runRaw, undefined, id, thisContextEyeLevel, attachToParent, disposeCallback);

    let result = Object.assign(outputEye as T, {
        [DisposeSymbol]() {
            run[DisposeSymbol]();
        },
        [DerivedIdSymbol]: run[DerivedIdSymbol],
    });
    Object.assign(run, { [derivedEyeSymbol]: result });

    // Might as do the first run AFTER we set everything up (as in derivedEyeSymbol, etc).
    context.forceUpdate();

    return result;
}

/*
export let derivedTriggerDiag: {
    [pathHash: string]: {
        count: number;
        duration: number;
        keyReads: number;
        watchedReads: number;
        lastWatchedReads: number;
    }
} = Object.create(null);

exposeDebugLookup("derivedTriggerDiag", derivedTriggerDiag, x => derivedTriggerDiag = x, [
    { query: getPathQuery([{ query: "" }, "count"]), },
    //{ query: getPathQuery([{ query: "" }]), hideColumn: true },
    //{ query: getPathQuery([{ query: "" }, "path"]), formatValue: ((value: EyeTypes.Path2) => value.path) as any },
    //{ query: rootPath },
    //{ query: p2("path"), formatValue: ((value: EyeTypes.Path2) => value.path.join(".")) as any },
    //{ query: p2("callbacks"), type: "lookup" },
    //{ path: pathFromArray(["callbacks", PathWildCardKey]), formatValue: (value) => String(value).slice(0, 100) },
]);
*/


let derivedStack: DerivedFnc[] = [];

const derivedStackId = createDerivedStackId();
function createDerivedStackId(): DeltaStateId<DerivedFnc> {
    return {
        startRun(state) {
            derivedStack.push(state);
        },
        finishRun(state) {
            derivedStack.pop();
        }
    };
}

/** Keeps a derived that is strongly attached to its parent alive for the current run, without running the underlying
 *      derived function (otherwise it would be disposed if it wasn't accessed).
 *      - To be used when you don't want to run the derived, but want to keep it alive.
 */
export function keepDerivedAlive(derived: { [DerivedIdSymbol]: string }): void {
    let parent = getParentDerived();
    // Don't warn or throw if it is a root derived, in that case it isn't that the user didn't strongly attach it, it is that
    //  a derived that supported memory management inside of deriveds is being used statically, which is fine, and expected,
    //  and just means it doesn't need the memory management support.
    //  - Or they called keepDerivedAlive asynchronously...
    if(!parent) return;
    if(!derived[DerivedIdSymbol]) {
        debugger;
        throw new Error(`Called keepDerivedAlive on non derived`);
    }
    if(!parent.strongAttachedChildren.has(derived[DerivedIdSymbol])) {
        debugger;
        throw new Error(`Invalid, called keepDerivedAlive on derived that isn't a strongly attached children, so it can't be free anyway`);
    }
    parent.strongAttachedChildrenCurrentlyAccessed.add(derived[DerivedIdSymbol]);
}

export interface DerivedFnc<T extends unknown = unknown, This extends ObserverThisContext = ObserverThisContext> {
    (this: This): T;
    [DisposeSymbol]: () => void;

    // TODO: Most of this should be private to derived.
    
    // key is derivedId
    children: Map<string, DerivedFnc<unknown, any>>;

    depth: number;

    strongAttachedChildren: Map<string, DerivedFnc<unknown, any>>;
    strongAttachedChildrenCurrentlyAccessed: Set<string>;

    [DerivedIdSymbol]: string;
}

export let globalAliveDerivedCount = 0;

export function getParentDerived(): DerivedFnc|undefined {
    let parentDeltaContext = DeltaContext.GetCurrent();
    if(!parentDeltaContext) return undefined;
    let parentState = parentDeltaContext.GetState(derivedStackId);
    if(!parentState) return undefined;
    return parentState;
}

/** derivedRaw's recursive functionality works via calling the this context's forceUpdate function.
 *      This puts the requirement of rerunning our "parent" on the caller.
*/
export function derivedRaw<T extends unknown, This extends ObserverThisContext>(
    fnc: (this: This) => T,
    niceName?: string,
    derivedIdInput?: string,
    thisContextEyeLevel?: EyeLevel,
    attachToParent: boolean|"weak" = false,
    disposeCallback?: () => void
): DerivedFnc<T, This> {

    let derivedId = derivedIdInput || niceName && createNewIdentifier(niceName) || createNewIdentifier(fnc.name);

    let parentDerived = getParentDerived();
    
    if(attachToParent && parentDerived) {
        let prevChildState = parentDerived.children.get(derivedId);
        if(prevChildState) {
            throw new Error(`Multiple derived attached to parent with same derivedId, ${derivedId}`);
        }
    }

    globalAliveDerivedCount++;

    let disposed = false;
    function dispose() {
        if(disposed) return;
        globalAliveDerivedCount--;
        disposed = true;
        unwatchPaths(derivedId);
        deltaContext.Dispose();

        for(let child of children.values()) {
            child[DisposeSymbol]();
        }
        children.clear();

        if(attachToParent && parentDerived) {
            parentDerived.children.delete(derivedId);
        }

        if(disposeCallback) {
            disposeCallback();
        }
    }

    let children: DerivedFnc<T, This>["children"] = new Map();
    let strongAttachedChildren: Map<string, DerivedFnc<unknown, any>> = new Map();
    let strongAttachedChildrenCurrentlyAccessed: Set<string> = new Set();
    

    let pendingChange = false;

    // Not the full accesses, just the non-delta accesses
    let curAccesses: AccessState = {
        reads: new Set(),
        keyReads: new Set(),
    };
    // Just the delta accesses
    let curDeltaAccesses: Map<ReadDelta["fullReads"], ReadDelta> = new Map();
    //  All of the counts of all the accesses.
    let accessCounts: {
        reads: Map<string, number>;
        keyReads: Map<string, number>;
    } = {
        reads: new Map(),
        keyReads: new Map(),
    };

    let thisContext: This;
    function callFnc() {
        return fnc.apply(thisContext);
    }

    let deltaContext = new DeltaContext(() => {
        deltaContext.GetOrAddState(derivedStackId, () => result);
        try {
            return callFnc();
        } finally {
            for(let [childDerivedId, child] of strongAttachedChildren) {
                if(!strongAttachedChildrenCurrentlyAccessed.has(childDerivedId)) {
                    child[DisposeSymbol]();
                    strongAttachedChildren.delete(childDerivedId);
                }
            }
            strongAttachedChildrenCurrentlyAccessed.clear();
        }
    });

    let result = Object.assign(wrapper, {
        // todonext: call this in the componentDidUnmount call, from the decorator
        // TODO: It seems like if there is ever a reason to use Proxy.revocable, this is it.
        // TODO: Maybe put dispose in the eye instead?
        // TODO: Hook this up via an argument, like forceUpdate, but... something like 'addDisposeCallback'.
        [DisposeSymbol]: dispose,
        children,
        strongAttachedChildren,
        strongAttachedChildrenCurrentlyAccessed,
        depth: (parentDerived?.depth || 0) + 1,
        [DerivedIdSymbol]: derivedId,
    });

    if(attachToParent && parentDerived) {
        // Adding to the derivedStack, etc, is handled in the stackId
        parentDerived.children.set(derivedId, result);

        if(attachToParent === true) {
            parentDerived.strongAttachedChildren.set(derivedId, result);
        }
    }

    return result;

    // TODO: Type check ReturnType, and if the type is a primitive, actually make it the correct { [BoxedValueSymbol] } type.
    function wrapper(this: This): ReturnType<typeof fnc> {
        if(disposed) return null as any;

        if(attachToParent === true && parentDerived) {
            parentDerived.strongAttachedChildrenCurrentlyAccessed.add(derivedId);
        }

        const forceUpdateCallback = () => {
            //console.info(`Inside triggering of derived ${name}`);
            pendingChange = false;
            this.forceUpdate();
        };

        const onChanged = (pathHash: string) => {
            if(pendingChange) return;
            pendingChange = true;
            let name = (this as any).name || this.constructor.name;

            //console.info(`Schedule triggering of derived ${name}`);
            scheduleCallback(forceUpdateCallback, result.depth.toFixed(10));
        };

        thisContext = this;
        if(canHaveChildren(this)) {
            thisContext = eye(this, thisContextEyeLevel, niceName && niceName + ".this");
        }
        

        // TODO: If we write to a path before we read from it, we should suppress the read,
        //  as writing to it means the read is from ourself (and so won't change if we rerun).

        let nextAccesses: AccessState = {
            reads: new Set(),
            keyReads: new Set(),
        };
        let nextDeltaAccesses: Map<ReadDelta["fullReads"], ReadDelta> = new Map();

        let output!: ReturnType<typeof fnc>;
        output = getReads(
            () => deltaContext.RunCode(),
            {
                read(path) {
                    nextAccesses.reads.add(path);
                    derivedTotalReads.value++;
                },
                readKeys(path) {
                    nextAccesses.keyReads.add(path);
                    derivedTotalReads.value++;
                },
                //*
                readDelta(delta) {
                    nextDeltaAccesses.set(delta.fullReads, delta);
                    derivedTotalReads.value++;
                },
                //*/
            },

            // We call this.forceUpdate on change, so we do notify our parent of changes.
            true
        );


        // We leave count at 0, because the count may increase again later. These sets keep track
        //  of the values we have to check for 0.
        let removeReadCandidates: Set<string> = new Set();
        let removeKeyReadCandidates: Set<string> = new Set();

        let readsDelta: PathDelta = { added: new Set(), removed: new Set() };
        let keyReadsDelta: PathDelta = { added: new Set(), removed: new Set() };

        addAccesses(curAccesses.reads, nextAccesses.reads, readsDelta, accessCounts.reads, removeReadCandidates);
        addAccesses(curAccesses.keyReads, nextAccesses.keyReads, keyReadsDelta, accessCounts.keyReads, removeKeyReadCandidates);

        addDeltaAccesses(curDeltaAccesses, nextDeltaAccesses, readsDelta, accessCounts.reads, removeReadCandidates);
        // NOTE: No delta accesses for key reads, we could have deltas for key reads, but it isn't necessary yet.

        checkCandidates(readsDelta, accessCounts.reads, removeReadCandidates);
        checkCandidates(keyReadsDelta, accessCounts.keyReads, removeKeyReadCandidates);


        curAccesses = nextAccesses;
        curDeltaAccesses = nextDeltaAccesses;

        watchPathsDelta(
            {
                reads: { added: readsDelta.added, removed: readsDelta.removed },
                keyReads: { added: keyReadsDelta.added, removed: keyReadsDelta.removed }
            },
            onChanged,
            derivedId
        );

        return output;

        function addAccess(
            pathHash: string,
            deltas: PathDelta,
            counts: Map<string, number>
        ) {
            deltas.added.add(pathHash);
            let count = counts.get(pathHash) || 0;
            counts.set(pathHash, count + 1);
        }
        function removeAccess(
            pathHash: string,
            counts: Map<string, number>,
            removeCandidates: Set<string>
        ) {
            let count = counts.get(pathHash);
            if(!count) {
                throw new Error(`Internal error, no counts even though value was accessed before. Or, this could be an issue with a delta read removing a value twice.`);
            }
            count--;
            counts.set(pathHash, count);
            
            if(count === 0) {
                removeCandidates.add(pathHash);
            }
        }

        function addAccesses(
            cur: AccessState["reads"],
            next: AccessState["reads"],
            deltas: PathDelta,
            counts: Map<string, number>,
            removeCandidates: Set<string>
        ) {
            for(let path of next) {
                if(!cur.has(path)) {
                    addAccess(path, deltas, counts);
                }
            }
            for(let path of cur) {
                if(!next.has(path)) {
                    removeAccess(path, counts, removeCandidates);
                }
            }
        }
        function addDeltaAccesses(
            cur: Map<ReadDelta["fullReads"], ReadDelta>,
            next: Map<ReadDelta["fullReads"], ReadDelta>,
            deltas: PathDelta,
            counts: Map<string, number>,
            removeCandidates: Set<string>
        ) {
            for(let [key, delta] of next) {
                if(!cur.has(key)) {
                    addAccesses(new Set(), delta.fullReads, deltas, counts, removeCandidates);
                } else {
                    for(let path of delta.readsAdded) {
                        addAccess(path, deltas, counts);
                    }
                    for(let path of delta.readsRemoved) {
                        removeAccess(path, counts, removeCandidates);
                    }
                }
            }
        }
        
        function checkCandidates(
            deltas: PathDelta,
            counts: Map<string, number>,
            removeCandidates: Set<string>
        ) {
            for(let key in removeCandidates) {
                let countObj = counts.get(key);
                if(countObj === undefined) {
                    throw new Error(`Internal error, missing count`);
                }
                if(countObj === 0) {
                    counts.delete(key);
                    deltas.removed.add(key);
                }
            }
        }
    }
}