export interface DeltaStateId<State extends object = any> {
    startRun?: (state: State) => void;
    finishRun?: (state: State) => void;
}

// All states extend DeltaState? But I guess it doesn't matter...
export type DeltaState = object;

// NOTE: DeltaContext is implicitly linked to eye/derived, and can't be used by a different system
//  in a nested fashion with eye/derived... simply because if there is a nested clal GetCurLookupDelta
//  won't know what delta you want it from. However an exact clone of DeltaContext with a different
//  name could be used in a different system, that would be fine.

/** DeltaContext is used to store state across runs of a derived, or something that performs
 *      the same function as derived, and has some interfacing with deriveds/eyes.
 * 
 *  Basically, there will be a context per watcher, and when you want to watch something, you subscribe with an object
 *      unique to what you are watching (likely actually the thing you are watching).
 *      And then when this thing changes, it will query across all contexts (via a WeakMap to make it fast), and
 *      put the changes in every context. It does not trigger any of these other contexts to run though.
 *      However, we know when the other contexts run, and then can use this to clean (or at least call out to functions
 *      to cleanup) the memory we stored in all of the other contexts.
 *      - So basically, this is actually mostly for memory management, and then implicitly provides functionality
 *          for tracking state, as otherwise users will, and then nothing will be managing their memory.
 * 
 *  Nested DeltaContexts are assumed to be independent, and so nesting inside of RunCode isolates you from any parent context.
 */
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

    public GetState<T extends DeltaState>(id: DeltaStateId<T> | Function&DeltaStateId<T>): T|undefined {
        if(!this.inRunCode) {
            throw new Error(`DeltaContext accessed outside of RunCode`);
        }
        let state: DeltaState|undefined = this.states.get(id);
        return state as T|undefined;
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
            debugger;
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

            for(let stateId of prevAccessedState) {
                if(!(this.stateAccessedInRun.has(stateId))) {
                    let state = this.states.get(stateId);
                    if(!state) throw new Error(`Internal error, prevAccessedState and this.states is out of sync.`);
                    this.states.delete(stateId);
                    let allStates = DeltaContext.AllStates.get(stateId);
                    if(!allStates) throw new Error(`Internal error, AllStates is out of sync`);
                    allStates.delete(this);
                    if(allStates.size === 0) {
                        DeltaContext.AllStates.delete(stateId);
                    }
                }
            }
            for(let stateId of this.stateAccessedInRun) {
                if(!prevAccessedState.has(stateId)) {
                    if(!DeltaContext.AllStates.has(stateId)) {
                        DeltaContext.AllStates.set(stateId, new Set());
                    }
                    DeltaContext.AllStates.get(stateId)?.add(this);
                }
            }

            for(let stateId of this.stateAccessedInRun) {
                if(stateId.finishRun) stateId.finishRun(this.states.get(stateId));
            }
        }
    }
    public Dispose() {
        this.code = (() => {}) as any;
        this.RunCode();
        this.disposed = true;
    }
}
