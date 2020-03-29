// Any lookup with this key should satisfy the { [lookupDelta]: () => ReturnType<typeof GetCurLookupDelta> } interface
export const lookupDelta = Symbol.for("lookupDelta");

// NOTE: Although this interface doesn't distinguish between a key not existing and undefined,
//  changes should still be triggered for values when they transition between those states.
// NOTE: prevValue is in reference to the value in the previous run of the DeltaContext, not just the last write.
export type DeltaChanges<Value> = Map<string, { prevValue: Value|undefined, newValue: Value|undefined }>;

// NOTE: There are two ways to implement this.
//  1) If there is only one user, then every time this is called it can return the delta since the last call.
//  2) If there are multiple users of the same lookup, then each can set a global flag indicating an identifier of the
//      user, and a global mechanism for when they want changes to apply to a new delta, or the previous delta.
// We take the second approach, as the first approach is flakey, and leads to can lead to unexpecting missing
//  of deltas.
// Also, even if we got this working without DeltaContext, we would likely create massive memory leaks, so DeltaContext
//  is really the best way to go (especially once WeakRef has better browser support, which will let us perfectly
//  release our resources once the underlying lookup is disposed, and therefore cannot be called with GetCurLookupDelta again).
export function GetCurLookupDelta<Value>(lookup: { [key: string]: Value }): {
    keysChanged: DeltaChanges<Value>
} {
    if(lookupDelta in lookup) {
        return (lookup as any)[lookupDelta]();
    } else {
        
        type ShimState = {
            prevValues: Map<string, Value>
        };
        let deltaContext = DeltaContext.GetCurrent();
        if(!deltaContext) {
            throw new Error(`GetCurLookupDelta either requires support the underlying lookup, or requires calling GetCurLookupDelta within a DeltaContext.`);
        }

        let shimState = deltaContext.GetOrAddState(GetCurLookupDelta, (): ShimState => ({ prevValues: new Map() }));
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

        return { keysChanged };
    }
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
