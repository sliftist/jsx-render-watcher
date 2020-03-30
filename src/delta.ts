import { sort, unreachable } from "./lib/algorithms";
import { LongestSequence } from "./lib/longestSequence";

// Any lookup with this key should satisfy the { [lookupDelta]: () => ReturnType<typeof GetCurLookupDelta> } interface
export const lookupDelta = Symbol.for("lookupDelta");

// NOTE: Although this interface doesn't distinguish between a key not existing and undefined,
//  changes should still be triggered for values when they transition between those states.
// NOTE: prevValue is in reference to the value in the previous run of the DeltaContext, not just the last write.
export type KeyDeltaChanges<Value> = Map<string|number, { prevValue: Value|undefined, newValue: Value|undefined }>;

// NOTE: There are two ways to implement this.
//  1) If there is only one user, then every time this is called it can return the delta since the last call.
//  2) If there are multiple users of the same lookup, then each can set a global flag indicating an identifier of the
//      user, and a global mechanism for when they want changes to apply to a new delta, or the previous delta.
// We take the second approach, as the first approach is flakey, and leads to can lead to unexpecting missing
//  of deltas.
// Also, even if we got this working without DeltaContext, we would likely create massive memory leaks, so DeltaContext
//  is really the best way to go (especially once WeakRef has better browser support, which will let us perfectly
//  release our resources once the underlying lookup is disposed, and therefore cannot be called with GetCurLookupDelta again).
export function GetCurLookupDelta<Value>(lookup: { [key: string]: Value } & { [lookupDelta]?: () => KeyDeltaChanges<Value> }): KeyDeltaChanges<Value> {
    let delta = lookup[lookupDelta];
    if(delta) {
        return delta();
    }
    type ShimState = {
        prevValues: Map<string, Value>
    };
    let deltaContext = DeltaContext.GetCurrent();
    if(!deltaContext) {
        throw new Error(`GetCurLookupDelta either requires support the underlying lookup, or requires calling GetCurLookupDelta within a DeltaContext.`);
    }

    let objKey = getCombinedObjectHash([lookup, GetCurLookupDelta]);
    let shimState = deltaContext.GetOrAddState(objKey, (): ShimState => ({ prevValues: new Map() }));
    let keysChanged = new Map<string, { prevValue: Value|undefined, newValue: Value|undefined }>();
    function keyMutated(key: string) {
        keysChanged.set(key, { prevValue: shimState.prevValues.get(key), newValue: lookup[key] });
    }

    for(let [key] of shimState.prevValues) {
        if(!(key in lookup)) {
            keyMutated(key);
            shimState.prevValues.delete(key);
        }
    }

    for(let key in lookup) {
        let value = lookup[key];
        if(!shimState.prevValues.has(key)) {
            keyMutated(key);
        } else if(value !== shimState.prevValues.get(key)) {
            keyMutated(key);
        }
        shimState.prevValues.set(key, value);
    }

    return keysChanged;
}


export const arrayDelta = Symbol.for("arrayDelta");
// TODO: Add a new operation that moves elements within an array, because our deltas can support it, and our mounting (will) support it,
//  it is just that there is no single operation to do it with arrays, because it had no use before...
// If a value is removed, newIndex === undefined, added, prevIndex === undefined, and if it is moved both indexes are set.
//  For mutations both indexes may stay the same.
//  - We only count moves as say, skipping over a value. When a splice happens and the indexs of all values above the deleted element
//      change, we don't trigger a delta of all those. This IS NOT a delta of the indexes, this represents a delta of the values,
//      or order, with prevIndex/newIndex existing for convenience.
//  - prevIndex refers to the last DeltaContext, newIndex the most recent, not the indexes before/after the change that triggered
//      their addition to the delta.
//  The general way to apply these mutations (when order matters), is to remove all deleted and changed elements, and
//      then re-add everything that is moved, in the newIndex order, using newArray[newIndex-1] as a reference point.
//  If order isn't important, the changes can be applied even more easily.
export type ArrayDelta<Value> = Map<Value, {
    prevIndex: number|undefined;
    newIndex: number|undefined;
}>;

export function GetCurArrayDelta<Value>(arr: Value[] & { [arrayDelta]?: () => ArrayDelta<Value> }): ArrayDelta<Value> {
    let delta = arr[arrayDelta];
    if(delta) {
        return delta();
    }


    type ShimState = {
        prevArraySlice: Value[];
    };
    let deltaContext = DeltaContext.GetCurrent();
    if(!deltaContext) {
        throw new Error(`GetCurArrayDelta either requires support the underlying lookup, or requires calling GetCurArrayDelta within a DeltaContext.`);
    }

    let objKey = getCombinedObjectHash([arr, GetCurArrayDelta]);
    // For the first run there should be no existing computed array (the thing calling CurCurArrayDelta should be creating a computed/derived
    //  array, or reducing it), so pretending like we had no previous state is the most correct thing to do.
    let shimState = deltaContext.GetOrAddState(objKey, (): ShimState => ({ prevArraySlice: [] }));

    let { prevArraySlice } = shimState;

    let newArrayIndexes = new Map<Value, number[]>();
    {
        for(let i = 0; i < arr.length; i++) {
            let newValue = arr[i];
            let indexes = newArrayIndexes.get(newValue);
            if(!indexes) {
                indexes = [];
                newArrayIndexes.set(newValue, indexes);
            }
            indexes.push(i);
        }
    }

    let deletions: { newIndex: undefined; prevIndex: number; value: Value }[] = [];
    let moves: { newIndex: number; prevIndex: number; value: Value }[] = [];
    let adds: { newIndex: number; prevIndex: undefined; value: Value }[] = [];

    // Find all moves and deletions
    for(let i = 0; i < prevArraySlice.length; i++) {
        let prevValue = prevArraySlice[i];
        let newIndexes = newArrayIndexes.get(prevValue);
        if(newIndexes) {
            let newIndex = newIndexes.shift();
            if(newIndex !== undefined) {
                moves.push({ newIndex, prevIndex: i, value: prevValue });
                continue;
            }
        }
        deletions.push({ newIndex: undefined, prevIndex: i, value: prevValue });
    }

    for(let [value, indexes] of newArrayIndexes) {
        while(true) {
            let newIndex = indexes.shift();
            if(newIndex === undefined) break;
            adds.push({ newIndex, prevIndex: undefined, value });
        }
    }

    // Takes the longest sequence of elements that are persisted, and in the same order, and don't apply them.
    //  This is because if we delete all the deleted elements, make the remaining in the correct order
    //  (relative to the non-changed elements), and insert any new ones, the final array will be correct, without
    //  touching the longest sequence.
    {
        // Moves is already ascending by prevIndex, so the value should be newIndex
        let { otherSequence } = LongestSequence(moves.map(x => x.newIndex));
        let newMovesOrder: typeof moves = [];
        for(let moveIndex of otherSequence) {
            newMovesOrder.push(moves[moveIndex]);
        }
        moves = newMovesOrder;
    }


    let changes: ArrayDelta<Value> = new Map();
    function addChange(obj: { newIndex: number|undefined; prevIndex: number|undefined; value: Value }) {
        changes.set(obj.value, { prevIndex: obj.prevIndex, newIndex: obj.newIndex });
    }
    deletions.forEach(addChange);
    moves.forEach(addChange);
    adds.forEach(addChange);
    return changes;
}



// TODO: Use WeakRefs to do this better. Right now if a child is destructed but not a parent we won't know to get rid of the parent.
//  (And we also store too many objects). With WeakRefs we can perfectly keep track of if any path is reachable, and if not, we can remove
//  the entire path.
type NestedWeakMap = WeakMap<object, { value: object; children: NestedWeakMap|undefined; }>;
let nestedWeakMaps: NestedWeakMap = new WeakMap();
function getCombinedObjectHash(objs: object[]): object {
    let curMap = nestedWeakMaps;
    for(let i = 0; i < objs.length; i++) {
        let obj = objs[i];
        let next = curMap.get(obj);
        if(next === undefined) {
            next = { value: Object.create(null), children: undefined };
            curMap.set(obj, next);
        }
        if(i === objs.length - 1) {
            return next.value;
        }
        if(next.children === undefined) {
            next.children = new WeakMap();
        }
        curMap = next.children;
    }
    throw new Error(`Internal error, unreachable`);
}


export interface DeltaStateId<State extends DeltaState = any> {
    startRun?: (state: State) => void;
    finishRun?: (state: State) => void;
}

export interface DeltaState {
    [key: string]: unknown;
}

export class DeltaContext<T = any> {

    // TODO: Set<DeltaContext> should really be Set<WeakRef<DeltaContext>>
    private static AllStates = new WeakMap<DeltaStateId, Set<DeltaContext>>();

    private static curContext: DeltaContext[] = [];

    // TODO: Should be Map<WeakRef<DeltaStateId>, WeakRef<DeltaState>>. This would mean if either the providers of
    //  the dependencies (DeltaState) or the user (RunContext), the states can go away. Although, if the underlying
    //  dependency we are getting a delta for goes away, it should probably trigger a change of the user of the dependency,
    //  so WeakRefs aren't THAT important.
    states = new Map<DeltaStateId, DeltaState>();
    stateAccessedInRun = new Set<DeltaStateId>();

    private disposed = false;
    private inRunCode = false;

    constructor(private code: () => T) { }


    public static GetCurrent(): DeltaContext|undefined {
        return DeltaContext.curContext[DeltaContext.curContext.length - 1];
    }

    public GetOrAddState<T extends DeltaState>(id: DeltaStateId | Function&DeltaStateId, defaultState: () => T): T {
        if(!this.inRunCode) {
            throw new Error(`DeltaContext accessed outside of RunCode`);
        }
        this.stateAccessedInRun.add(id);
        if(!this.states.has(id)) {
            let defState = defaultState();
            this.states.set(id, defState);
            if(id.startRun) id.startRun(defState);
        }
        return this.states.get(id) as T;
    }

    /** Used to prepare delta across all contexts. This is required, as opposed to polling, as usually it is not viable
     *      to keep the deltas available forever, so they must be placed into the contexts that will use them,
     *      and then disposed of by those contexts when they are done with them.
     */
    public static GetAllStates<State extends DeltaState>(id: DeltaStateId<State>): State[] {
        let set = DeltaContext.AllStates.get(id);
        if(!set) return [];
        return Array.from(set.keys()).map(x => x.states.get(id)).filter((x): x is State => !!x);
    }

    public RunCode() {
        if(this.disposed) {
            throw new Error(`Disposed DeltaContext RunCode called`);
        }
        return this.runCode();
    }
    private runCode() {
        this.inRunCode = true;
        let prevAccessedState = this.stateAccessedInRun;
        this.stateAccessedInRun = new Set();
        DeltaContext.curContext.push(this);

        for(let state of prevAccessedState) {
            if(state.startRun) state.startRun(this.states.get(state));
        }

        try {
            return this.code();
        } finally {
            this.inRunCode = false;
            DeltaContext.curContext.pop();

            for(let prevState of prevAccessedState) {
                if(!(this.stateAccessedInRun.has(prevState))) {
                    this.states.delete(prevState);
                    DeltaContext.AllStates.get(prevState)?.delete(this);
                }
            }
            for(let newState of this.stateAccessedInRun) {
                if(!prevAccessedState.has(newState)) {
                    if(!DeltaContext.AllStates.has(newState)) {
                        DeltaContext.AllStates.set(newState, new Set());
                    }
                    DeltaContext.AllStates.get(newState)?.add(this);
                }
            }

            for(let state of this.stateAccessedInRun) {
                if(state.finishRun) state.finishRun(this.states.get(state));
            }
        }
    }
    public Dispose() {
        this.code = (() => {}) as any;
        this.RunCode();
        this.disposed = true;
    }
}
