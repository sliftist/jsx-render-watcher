import { watchAccesses, getReads, ReadDelta, registerDeltaReadAccess, registerKeysReadAccess } from "./accessEvents";
import { eye, Eye1_root, EyeType, eye1_root, eye0_pure, EyeLevel, EyePath, GetUniqueRootPath } from "./eye";
import { watchPaths, AccessState, unwatchPaths, watchPathsDelta, PathDelta } from "./getAccesses";
import { canHaveChildren, insertIntoListMapped } from "./lib/algorithms";
import { getRootKey, pathFromArray } from "./lib/path";
import { exposeDebugLookup } from "./debugUtils/exposeDebug";
import { getPathQuery } from "./debugUtils/searcher";
import { DeltaContext } from "./delta";

export const BoxedValueSymbol = Symbol("BoxedValueSymbol");
export const DisposeSymbol = Symbol("DisposeSymbol");

type ObserverThisContext = {
    forceUpdate: () => void;
    // The order of these strings (< is sooner) determines the order at which forceUpdate is called...
    //  undefined is last.
    updateOrder?: string;
};

let scheduledCallbacks: {callback: () => void; order: string|undefined}[] | undefined = undefined;
function scheduleCallback(callback: () => void, order: string|undefined) {
    if(!scheduledCallbacks) {
        scheduledCallbacks = [];
        let callbacks = scheduledCallbacks;
        Promise.resolve().then(() => {
            scheduledCallbacks = undefined;
            for(let callback of callbacks) {
                callback.callback();
            }
        });
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
    });
}


// TODO: A check if where we do our Promise.resolve(), to see if it infinitely loops, and in which case...
//  - Probably just log a message every 1 seconds saying that we are still looping. It should log fine, as we
//      are Promise.resolving, so the main loop shouldn't block? I think?

// NOTE: We don't accept any arguments, as this should act as a singleton, not accepting any arguments.
//  IF you want a function memoizer, wrap this with something that keeps a context per set of arguments.

export function derived<T extends unknown>(
    fnc: () => T,
    niceName?: string,
    thisContextEyeLevel?: EyeLevel,
    config?: {
        singleton: boolean
    }
): T {
    // We notify our parents of important updates, because we return the result as an eye. If the parent doesn't
    //  utilize the output eye (or parts of it), then it doesn't need to know when we change, which is fine.

    let outputEye = eye0_pure({} as { [key in PropertyKey]: unknown }, niceName, config);

    let run!: typeof runRaw; 
    function runRaw(this: typeof context) {
        return fnc.call(this);
    }
    let context = {
        name: niceName || fnc.name,
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
    run = derivedRaw(runRaw, { path: outputEye[EyePath], thisContextEyeLevel });
    context.forceUpdate();

    return outputEye as T;
}


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

export function derivedRaw<T extends unknown, This extends ObserverThisContext>(
    fnc: (this: This) => T,
    config: {
        niceName?: string;
        path?: EyeTypes.Path2;
        thisContextEyeLevel?: EyeLevel;
    }
): (this: This) => T {

    let { niceName, path, thisContextEyeLevel } = config;

    if(!path) {
        path = GetUniqueRootPath(niceName);
    }
    let pathTyped = path;

    let disposed = false;
    let pendingChange = false;

    // Not the full accesses, just the non-delta accesses
    let curAccesses: AccessState = {
        reads: new Map(),
        keyReads: new Map(),
    };
    // Just the delta accesses
    let curDeltaAccesses: Map<ReadDelta["fullReads"], ReadDelta> = new Map();
    //  All of the counts of all the accesses.
    let accessCounts: {
        reads: Map<string, { path: EyeTypes.Path2; count: number }>;
        keyReads: Map<string, { path: EyeTypes.Path2; count: number }>;
    } = {
        reads: new Map(),
        keyReads: new Map(),
    };

    let thisContext: This;
    function callFnc() {
        return fnc.apply(thisContext);
    }
    let deltaContext = new DeltaContext(callFnc);

    return Object.assign(wrapper, {
        // todonext: call this in the componentDidUnmount call, from the decorator
        // TODO: It seems like if there is ever a reason to use Proxy.revocable, this is it.
        // TODO: Maybe put dispose in the eye instead?
        // TODO: Hook this up via an argument, like forceUpdate, but... something like 'addDisposeCallback'.
        [DisposeSymbol]: () => {
            disposed = true;
            unwatchPaths(pathTyped.pathHash);
        }
    });

    // TODO: Type check ReturnType, and if the type is a primitive, actually make it the correct { [BoxedValueSymbol] } type.
    function wrapper(this: This): ReturnType<typeof fnc> {
        if(disposed) return null as any;

        const onChanged = (path: EyeTypes.Path2) => {
            if(pendingChange) return;
            pendingChange = true;
            let name = (this as any).name || this.constructor.name;

            
            console.info(`Schedule triggering of derived ${name}`);
            scheduleCallback(() => {
                console.info(`Inside triggering of derived ${name}`);
                pendingChange = false;
                this.forceUpdate();
            }, path.pathHash);
        };

        thisContext = this;
        if(thisContextEyeLevel !== undefined && canHaveChildren(this)) {
            thisContext = eye(this, thisContextEyeLevel);
        }

        if(!derivedTriggerDiag[pathTyped.pathHash]) {
            derivedTriggerDiag[pathTyped.pathHash] = { count: 0, duration: 0, keyReads: 0, watchedReads: 0, lastWatchedReads: 0 };
        }
        derivedTriggerDiag[pathTyped.pathHash].count++;

        let time = Date.now();
        try {
            // TODO: If we write to a path before we read from it, we should suppress the read,
            //  as writing to it means the read is from ourself (and so won't change if we rerun).

            let nextAccesses: AccessState = {
                reads: new Map(),
                keyReads: new Map(),
            };
            let nextDeltaAccesses: Map<ReadDelta["fullReads"], ReadDelta> = new Map();

            let output!: ReturnType<typeof fnc>;
            output = getReads(
                () => deltaContext.RunCode(),
                {
                    read(path) {
                        nextAccesses.reads.set(path.pathHash, {path});
                    },
                    readKeys(path) {
                        nextAccesses.keyReads.set(path.pathHash, {path});
                    },
                    //*
                    readDelta(delta) {
                        nextDeltaAccesses.set(delta.fullReads, delta);
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

            let readsDelta: PathDelta = { added: new Map(), removed: new Map() };
            let keyReadsDelta: PathDelta = { added: new Map(), removed: new Map() };

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
                pathTyped.pathHash
            );

            let curReadsCount = nextAccesses.reads.size + Array.from(nextDeltaAccesses.values()).map(x => x.readsAdded.size).reduce((a, b) => a + b, 0);
            let curKeyReadsCount = nextAccesses.keyReads.size;

            derivedTriggerDiag[pathTyped.pathHash].watchedReads += curReadsCount;
            derivedTriggerDiag[pathTyped.pathHash].keyReads += curKeyReadsCount;
            derivedTriggerDiag[pathTyped.pathHash].lastWatchedReads = curReadsCount;

            return output;

            function addKey(
                path: EyeTypes.Path2,
                deltas: PathDelta,
                counts: Map<string, { path: EyeTypes.Path2; count: number }>
            ) {
                let key = path.pathHash;
                deltas.added.set(key, {path});
                let obj = counts.get(key);
                if(!obj) {
                    obj = { path, count: 0 };
                    counts.set(key, obj);
                }
                obj.count++;
            }
            function removeKey(
                path: EyeTypes.Path2,
                counts: Map<string, { path: EyeTypes.Path2; count: number }>,
                removeCandidates: Set<string>
            ) {
                let key = path.pathHash;
                let obj = counts.get(key);
                if(!obj) {
                    throw new Error(`Internal error, no counts even though value was accessed before`);
                }
                obj.count--;
                if(obj.count === 0) {
                    removeCandidates.add(key);
                }
            }

            function addAccesses(
                cur: AccessState["reads"],
                next: AccessState["reads"],
                deltas: PathDelta,
                counts: Map<string, { path: EyeTypes.Path2; count: number }>,
                removeCandidates: Set<string>
            ) {
                for(let [key, path] of next) {
                    if(!cur.has(key)) {
                        addKey(path.path, deltas, counts);
                    }
                }
                for(let [key, path] of cur) {
                    if(!next.has(key)) {
                        removeKey(path.path, counts, removeCandidates);
                    }
                }
            }
            function addDeltaAccesses(
                cur: Map<ReadDelta["fullReads"], ReadDelta>,
                next: Map<ReadDelta["fullReads"], ReadDelta>,
                deltas: PathDelta,
                counts: Map<string, { path: EyeTypes.Path2; count: number }>,
                removeCandidates: Set<string>
            ) {
                for(let [key, delta] of next) {
                    if(!cur.has(key)) {
                        addAccesses(new Map(), delta.fullReads, deltas, counts, removeCandidates);
                    } else {
                        for(let [key, path] of delta.readsAdded) {
                            addKey(path, deltas, counts);
                        }
                        for(let [key, path] of delta.readsRemoved) {
                            removeKey(path, counts, removeCandidates);
                        }
                    }
                }
            }
            
            function checkCandidates(
                deltas: PathDelta,
                counts: Map<string, { path: EyeTypes.Path2; count: number }>,
                removeCandidates: Set<string>
            ) {
                for(let key in removeCandidates) {
                    let countObj = counts.get(key);
                    if(countObj === undefined) {
                        throw new Error(`Internal error, missing count`);
                    }
                    if(countObj.count === 0) {
                        counts.delete(key);
                        deltas.removed.set(key, countObj);
                    }
                }
            }
        } finally {
            time = Date.now() - time;
            derivedTriggerDiag[pathTyped.pathHash].duration += time;
        }
    }
}