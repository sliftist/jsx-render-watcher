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
export type ArrayDeltaObj<Value> = Value[] & { [arrayDelta]?: () => ArrayDelta };

export type ArrayDelta = {
    // Delta must be applied in this order: removes, insert
    //  The aux stack is a stack used during the delta, to describe moves. It isn't needed if moves aren't important,
    //  as moves can equally just be interpretted as a remove followed by an insertion.

    // Indexes of removes ordered from high to low, so removals don't break their own indexes
    //  If the number is < 0, it becomes the ~ of the value, and should push to the aux stack.
    removes: number[];
    // Insert. If the number < 0, it becomes ~ of the value.
    //  The values are sorted low to high, and are the indexes in the final array. The array itself
    //  is already changed, so the values can be obtained simply from reading the final array.
    //  If the value is < 0, then it pops the auxOrder, and takes the value from the aux stack at the index
    //  of the popped value, and that value is the value inserted.
    //  This value is equal to the value in the final array, however the fact that is came from the array
    //  in the first place can be used as an optimization.
    inserts: number[];
    auxOrder: number[];
};

export function GetCurArrayDelta<Value>(arr: ArrayDeltaObj<Value>): ArrayDelta {
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

    let newArray = arr;


    let movedPrevIndexes: Set<number> = new Set();
    let movedNewIndexes: Set<number> = new Set();

    let persistedPrevIndexes: Set<number> = new Set();
    let persistedNewIndexes: Set<number> = new Set();

    // from newIndex to stack index
    let auxStack: Map<number, number> = new Map();

    let auxOrder: number[] = [];

    {
        let newArrayIndexes = new Map<Value, { list: number[]; nextIndex: number; }>();
        for(let i = 0; i < arr.length; i++) {
            let newValue = arr[i];
            let indexes = newArrayIndexes.get(newValue);
            if(!indexes) {
                indexes = { list: [], nextIndex: 0 };
                newArrayIndexes.set(newValue, indexes);
            }
            indexes.list.push(i);
        }

        let moveNewIndexesArr: number[] = [];
        let movePrevIndexesArr: number[] = [];

        let stackIndex = 0;
        for(let i = 0; i < prevArraySlice.length; i++) {
            let prevValue = prevArraySlice[i];
            let newIndexes = newArrayIndexes.get(prevValue);
            if(newIndexes) {
                let newIndex = newIndexes.list[newIndexes.nextIndex++];
                if(newIndex !== undefined) {
                    moveNewIndexesArr.push(newIndex);
                    movePrevIndexesArr.push(i);
                    continue;
                }
            }
        }

        // Takes the longest sequence of elements that are persisted, and in the same order, and don't apply them.
        //  This is because if we delete all the deleted elements, make the remaining in the correct order
        //  (relative to the non-changed elements), and insert any new ones, the final array will be correct, without
        //  touching the longest sequence.
    
        // Moves is already ascending by prevIndex, so the value should be newIndex
        let { otherSequence } = LongestSequence(moveNewIndexesArr);
        for(let i = 0; i < otherSequence.length; i++) {
            let moveIndex = otherSequence[i];
            let prev = movePrevIndexesArr[moveIndex];
            let next = moveNewIndexesArr[moveIndex];
            movedPrevIndexes.add(prev);
            movedNewIndexes.add(next);
        }

        for(let i = 0; i < movePrevIndexesArr.length; i++) {
            let prevIndex = movePrevIndexesArr[i];
            let newIndex = moveNewIndexesArr[i];
            if(!movedPrevIndexes.has(prevIndex)) {
                persistedPrevIndexes.add(prevIndex);
                persistedNewIndexes.add(newIndex);
            } else {
                auxStack.set(newIndex, stackIndex++);
            }
        }
    }


    let removes: number[] = [];
    //let moves: { newIndex: number; prevIndex: number; value: Value }[] = [];
    let inserts: number[] = [];

    // Find all moves and deletions, by going through the original array and looking in the
    //  new array structure
    for(let prevIndex = prevArraySlice.length - 1; prevIndex >= 0; prevIndex--) {
        if(movedPrevIndexes.has(prevIndex)) {
            removes.push(~prevIndex);
        } else if (persistedPrevIndexes.has(prevIndex)) {

        } else {
            removes.push(prevIndex);
        }
    }

    // Go through all the remaining values in the new array structure. All of the remaining values
    //  are insertions.
    for(let newIndex = 0; newIndex < newArray.length; newIndex++) {
        if(movedNewIndexes.has(newIndex)) {
            inserts.push(~newIndex);
            let auxStackIndex = auxStack.get(newIndex);
            if(auxStackIndex === undefined) {
                throw new Error(`Internal errror, auxStack messed up`);
            }
            auxOrder.push(auxStackIndex);
        } else if (persistedNewIndexes.has(newIndex)) {

        } else {
            inserts.push(newIndex);
        }
    }

    shimState.prevArraySlice = arr.slice();

    return {
        removes,
        inserts,
        auxOrder,
    };
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
