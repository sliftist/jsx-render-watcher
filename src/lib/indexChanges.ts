import { ArrayDelta } from "../delta/deltaDefaults";
import { sort } from "./algorithms";
import { g } from "pchannel";
import { AATreeArray } from "./AATreeArray";

//todonext;
//  Oh wait... for our index delta problem... we can just keep track of our array of changes as ranges,
//  and then apply them to a list of unchanged ranges (starting as everything). Deletes split ranges,
//      and insertions add new ranges that are marked as changed.
//  And then the unchanged ranges can store "original index", and just by iterating over the final range list we can
//  get "prev index". And then inverting the unchanged ranges will give us changed ranges...
//  - And moves with auxOrder would be easy to calculate, we just keep track of the values in auxStack, and then
//      take them out as we use them.
//      - Then add a TODO to support values being removed, and then added, in such a way that they don't need to be added or removed
//          anymore... it is hard, and we will probably never support it, but... if LongestSequence ever supports ranges,
//          we might do it.


export type ArrayMutation = {
    index: number;
    // If < 0 it means there was a deletion at the index, > 0 there was an insert. A set should be turned into
    //  a delete and then insertion.
    sizeDelta: number;
};


//todonext
// Actually... after we get getChanges working... we should do this. Basically, it just means that sumList is
//  maintained in realtime, so deletions can be tracked BEFORE the values are deleted, which lets us store
//  them in a sorted list that represents the auxStack correctly.
// TODO: We could probably use SkipList to store values in an array (which allows lookup by index, and is fast to update),
//  and then with this we could store all the indexes of values from the original array, so we could get the original indexes
//  from our deletions (which is otherwise hard, because sorting by the index at the time of deletion may be out of
//  order from the original index order, which is the order the deletions will be applied in with the delta)... which
//  would let us store a sorted list of the auxStack, which we could then use to map a Map, which would then let
//  us do moves as well.


type Range = {
    state: "unchanged"|"inserted";
    originalIndex: number;
};
type RangeIndex = {
    size: number;
};
type RangeObj = {
    value: Range;
    sumIncluded: RangeIndex;
}
class RangeList {
    list: RangeObj[] = [];
    public mutateSumRange(searchStart: RangeIndex, searchEnd: RangeIndex, mutate: (before: RangeIndex, values: RangeObj[]) => RangeObj[]): void {
        let { list } = this;

        // We are doing something of a two range overlap here. As in, we are looking over values
        //  in the list, which are ranges, and we want to match against a range. So this is a bet cumbersome,
        //  and makes some assumptions about the ranges (that there are no gaps), etc.

        let values: RangeObj[] = [];

        let listIndex = 0;
        let pos = 0;
        while(listIndex < list.length) {
            let { size } = list[listIndex].sumIncluded;
            if(pos + size > searchStart.size) break;
            pos += size;
            listIndex++;
        }

        let posStart = pos;
        let listStartIndex = listIndex;

        while(listIndex < list.length) {
            let listObj = list[listIndex++];
            pos += listObj.sumIncluded.size;
            values.push(listObj);
            if(pos >= searchEnd.size) break;
        }

        let newValues = mutate({ size: posStart }, values.slice());

        list.splice(listStartIndex, values.length, ...newValues);
    }
    public getAllNodes() {
        return this.list;
    }
    public getSize() {
        return this.list.reduce((a, b) => a + b.sumIncluded.size, 0);
    }
}

export class MutationList {
    rangeList = new RangeList();

    deletions: {
        originalIndex: number;
        size: number;
    }[] = [];

    public constructor(arrayOriginalSize: number) {
        this.rangeList.mutateSumRange({size: 0}, { size: 0 }, () => [{ value: { state: "unchanged", originalIndex: 0 }, sumIncluded: { size: arrayOriginalSize } }]);
    }

    public addMutation(mutationIndex: number, mutationDelta: number): void {
        let size = this.rangeList.getSize();
        if(mutationIndex < 0) {
            return this.addMutation(mutationIndex + size, mutationDelta);
        }
        if(mutationDelta === 0) return;
        let sumList = this.rangeList;
        let { deletions } = this;

        if(mutationDelta > 0) {
            let insertedRange = { value: { originalIndex: -1, state: "inserted" } as Range, sumIncluded: { size: mutationDelta } };
            sumList.mutateSumRange(
                { size: mutationIndex },
                { size: mutationIndex },
                (valuesStart, values) => {
                    if(values.length === 0) {
                        return [insertedRange];
                    } else if(values.length === 1) {
                        let value = values[0];
                        let index = valuesStart?.size || 0;
                        let { originalIndex, state } = value.value;
                        let beforeSize = mutationIndex - index;
                        let afterSize = value.sumIncluded.size - beforeSize;
                        values = [];
                        if(beforeSize > 0) {
                            if(originalIndex >= 0) {
                                values.push({ sumIncluded: { size: beforeSize }, value: { originalIndex: originalIndex, state } });
                            } else {
                                // If before is an insert, merge it with our current insert
                                insertedRange.sumIncluded.size += beforeSize;
                            }
                        }
                        values.push(insertedRange);
                        if(afterSize > 0) {
                            if(originalIndex >= 0) {
                                values.push({ sumIncluded: { size: afterSize }, value: { originalIndex: originalIndex + beforeSize, state } });
                            } else {
                                // If after is an insert, merge it with our current insert
                                insertedRange.sumIncluded.size += afterSize;
                            }
                        }
                        return values;
                    } else {
                        debugger;
                        throw new Error(`Unexpected multiple collisions with zero length range`);
                    }
                }
            );
        } else {
            let deleteSize = -mutationDelta;
            let deleteStart = mutationIndex;
            let deleteEnd = deleteStart + deleteSize;

            // BUG: It is adding the before sum twice when we get to the one before values? So it shouldn't add it twice,
            //  and then we would iterate over more sums
            sumList.mutateSumRange(
                { size: deleteStart },
                { size: deleteStart + deleteSize },
                (valuesStart, values) => {
                    

                    let indexStart = valuesStart?.size || 0;
                    if(indexStart > deleteStart) {
                        debugger;
                        throw new Error(`Internal error, the mutation was before the first range matched, but the ranges should go to index 0, and the mutation should be at >= 0, so... this is impossible`);
                    }

                    // The delete mutions indexes are in the currentIndex space, and so application is fairly simple. However when removing from an unchanged range we have
                    //  to take the offset in the unchanged range and add it to the originalIndex, instead of using the currentIndex.

                    let curValueIndexEnd = indexStart + values.reduce((a, b) => a + b.sumIncluded.size, 0);

                    for(let i = values.length - 1; i >= 0; i--) {
                        let value = values[i];
                        let size = value.sumIncluded.size;
                        let state = value.value.state;
                        let curValueIndexStart = curValueIndexEnd - size;
                        let originalIndexOffset = value.value.originalIndex - curValueIndexStart;

                        let newValues: {
                            sumIncluded: RangeIndex;
                            value: Range;
                        }[] = [];
                        if(curValueIndexStart < deleteStart) {
                            newValues.push({ value: { originalIndex: curValueIndexStart + originalIndexOffset, state }, sumIncluded: { size: deleteStart - curValueIndexStart } });
                        }
                        if(curValueIndexEnd > deleteEnd) {
                            newValues.push({ value: { originalIndex: deleteEnd + originalIndexOffset, state }, sumIncluded: { size: curValueIndexEnd - deleteEnd } });
                        }

                        if(value.value.state === "unchanged") {
                            let curStart = Math.max(deleteStart, curValueIndexStart);
                            let curEnd = Math.min(deleteEnd, curValueIndexEnd);

                            deletions.push({ originalIndex: curStart + originalIndexOffset, size: curEnd - curStart });
                        }

                        values.splice(i, 1, ...newValues);

                        curValueIndexEnd -= size;
                    }

                    return values;
                }
            );
        }
    }
    public getDelta(): ArrayDelta {
        let sumList = this.rangeList;
        let { deletions } = this;

        let delta: ArrayDelta = {
            auxOrder: [],
            inserts: [],
            removes: [],
        };

        let finalRanges = sumList.getAllNodes();
        let curIndex = 0;
        for(let range of finalRanges) {
            let size = range.sumIncluded.size;
            if(range.value.state === "inserted") {
                for(let i = 0; i < size; i++) {
                    delta.inserts.push(curIndex + i);
                }
            }
            curIndex += size;
        }
    
        for(let deleteRange of deletions) {
            let { originalIndex, size } = deleteRange;
            for(let i = originalIndex; i < originalIndex + size; i++) {
                delta.removes.push(i);
            }
        }
    
        sort(delta.removes, x => -x);
        sort(delta.inserts, x => x);

        return delta;
    }
}

export class ArrayDeltaHolder<T = unknown> {
    private originalOrder: T[];
    private mutationList: MutationList;
    public constructor(private underlyingArray: T[], initializeAllChanged = false) {
        this.originalOrder = underlyingArray.slice();
        if(initializeAllChanged) {
            this.mutationList = new MutationList(0);
            this.onArrayLengthChange(0, underlyingArray.length);
        } else {
            this.mutationList = new MutationList(this.originalOrder.length);
        }
    }

    public onArrayLengthChange(index: number, count: number): void {
        this.mutationList.addMutation(index, count);
    }
    public onArraySet(index: number): void {
        this.mutationList.addMutation(index, -1);
        this.mutationList.addMutation(index, +1);
    }

    public getDelta(): ArrayDelta {
        let delta = this.mutationList.getDelta();
        addDeltaMoves(delta, this.originalOrder, this.underlyingArray);
        return delta;
    }
}

/** Adds moves to a delta. */
export function addDeltaMoves<T>(delta: ArrayDelta, prevOrder: T[], newOrder: T[]): void {
    if(delta.auxOrder.length > 0) {
        throw new Error(`Merged delta moves is not implemented yet, addDeltaMoves only works if there are no existing moves`);
    }

    // Value to indexes in delta.inserts
    let newValueLookup: Map<T, number[]> = new Map();
    for(let i = 0; i < delta.inserts.length; i++) {
        let newIndex = delta.inserts[i];
        // Ignore it, if it's already a move
        if(newIndex < 0) {
            throw new Error(`Pushing to aux stack with no auxOrder. Not invalid, but we don't support existing moves in addDeltaMoves yet`);
        }
        let value = newOrder[newIndex];
        let deltaInserts = newValueLookup.get(value);
        if(!deltaInserts) {
            deltaInserts = [];
            newValueLookup.set(value, deltaInserts);
        }
        deltaInserts.push(i);
    }


    let auxStackIndex = 0;
    let auxOrderByInsertIndex: { auxStackIndex: number; insertIndex: number }[] = [];
    for(let i = 0; i < delta.removes.length; i++) {
        let removeIndex = delta.removes[i];
        if(removeIndex < 0) {
            throw new Error(`Pushing to aux stack with no auxOrder. Not invalid, but we don't support existing moves in addDeltaMoves yet`);
        }
        
        let value = prevOrder[removeIndex];

        let newIndexes = newValueLookup.get(value);
        if(newIndexes) {
            // Take from the end
            let index = newIndexes.pop();
            if(index !== undefined) {
                let insertIndex = delta.inserts[index];
                delta.inserts[index] = ~delta.inserts[index];
                delta.removes[i] = ~delta.removes[i];
                auxOrderByInsertIndex.push({ auxStackIndex, insertIndex });
                auxStackIndex++;
            }
        }
    }

    sort(auxOrderByInsertIndex, x => x.insertIndex);
    delta.auxOrder = auxOrderByInsertIndex.map(x => x.auxStackIndex);
}

//todonext;
// Okay, make this a class, that takes mutations one at a time? And then can finalize the output at any time,
//  BUT, also takes an arrNew and arrPrev when finalizating the output, which it uses to generate moves.
//  We should probably write a test or two for moves as well...

export function AATreeArrayGetChanges(arrayOriginalSize: number, mutations: ArrayMutation[]) {
     // The value is the original index.
     let arrayTree = new AATreeArray<number>();
     for(let i = 0; i < arrayOriginalSize; i++) {
         arrayTree.Insert(i, i);
     }
 
     for(let i = 0; i < mutations.length; i++) {
         let mutation = mutations[i];
         g.mutateIndex = i;
         if(g.breakOnThisMutateIndex && g.mutateIndex === g.breakOnThisMutateIndex) {
             debugger;
         }
         
         if(mutation.sizeDelta === 0) continue;
         if(mutation.sizeDelta < 0) {
             for(let i = 0; i < -mutation.sizeDelta; i++) {
                 arrayTree.Remove(mutation.index);
             }
         } else {
             for(let i = 0; i < mutation.sizeDelta; i++) {
                 let index = i + mutation.index;
                 arrayTree.Insert(index, -1);
             }
         }
     }
 
     let removes: number[] = [];
     let inserts: number[] = [];
 
     let newLength = arrayTree.GetLength();
     let nextPrevIndex = 0;
     for(let i = 0; i < newLength; i++) {
         let prevIndex = arrayTree.Get(i);
         if(prevIndex === undefined) {
             debugger;
             arrayTree.Get(i);
             throw new Error(`Internal error, invalid AATreeArray, at index ${i}, length ${newLength}`);
         }
 
         if(prevIndex === -1) {
             inserts.push(i);
         } else {
             for(let prevIndexRemoved = nextPrevIndex; prevIndexRemoved < prevIndex; prevIndexRemoved++) {
                 removes.push(prevIndexRemoved);
             }
             nextPrevIndex = prevIndex + 1;
         }
     }
     for(let prevIndexRemoved = nextPrevIndex; prevIndexRemoved < arrayOriginalSize; prevIndexRemoved++) {
         removes.push(prevIndexRemoved);
     }
 
     removes.reverse();
 
     return {
         removes,
         inserts,
         auxOrder: []
     }; 
}

/** Mutations should include deletes, inserts AND sets (and of course, in order they were originally applied). */
export function getChanges(arrayOriginalSize: number, mutations: ArrayMutation[], smallSplitFactor: boolean): ArrayDelta {
    let mutationList = new MutationList(arrayOriginalSize);
    for (let { index, sizeDelta } of mutations) {
        mutationList.addMutation(index, sizeDelta);
    }

    return mutationList.getDelta();
}