import { ArrayDelta } from "../delta";
import { SkipList, linkedListToList } from "./SkipList";
import { sort } from "./algorithms";
import { g } from "pchannel";

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

g.linkedListToList = linkedListToList;

//todonext;
// Okay, make this a class, that takes mutations one at a time? And then can finalize the output at any time,
//  BUT, also takes an arrNew and arrPrev when finalizating the output, which it uses to generate moves.
//  We should probably write a test or two for moves as well...

/** Mutations should include deletes, inserts AND sets (and of course, in order they were originally applied). */
export function getChanges(arrayOriginalSize: number, mutations: ArrayMutation[], smallSplitFactor: boolean): ArrayDelta {
    type Range = {
        state: "unchanged"|"inserted";
        originalIndex: number;
    };
    type RangeIndex = {
        size: number;
    };

    let sumList = new SkipList<Range, RangeIndex>(
        (lhs, rhs) => ({ size: lhs.size + rhs.size }),
        (lhs, rhs) => lhs.sumBefore.size - rhs.sumBefore.size,
        smallSplitFactor ? ({ splitThreshold: 4, joinThreshold: 2 }) : undefined
    );

    sumList.addNode({ state: "unchanged", originalIndex: 0 }, { size: arrayOriginalSize }, { size: 0 });

    let deletions: {
        originalIndex: number;
        size: number;
    }[] = [];

    for(let i = 0; i < mutations.length; i++) {
        g.mutateIndex = i;

        if(g.curTestName === "test large scale 0" && g.mutateIndex === 42 && g.loopIndex === 20) {
            debugger;
        }

        let mutation = mutations[i];
        if(mutation.index < 0) {
            throw new Error(`Index should not be before the start of the array`);
        }
        if(mutation.sizeDelta === 0) continue;
        if(mutation.sizeDelta > 0) {
            let insertedRange = { value: { originalIndex: -1, state: "inserted" } as Range, sumIncluded: { size: mutation.sizeDelta } };
            sumList.mutateSumRange(
                { size: mutation.index },
                { size: mutation.index },
                (valuesStart, values) => {
                    if(values.length === 0) {
                        return [insertedRange];
                    } else if(values.length === 1) {
                        let value = values[0];
                        let index = valuesStart?.size || 0;
                        let { originalIndex, state } = value.value;
                        let beforeSize = mutation.index - index;
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
            let deleteSize = -mutation.sizeDelta;
            let deleteStart = mutation.index;
            let deleteEnd = deleteStart + deleteSize;

            // BUG: It is adding the before sum twice when we get to the one before values? So it shouldn't add it twice,
            //  and then we would iterate over more sums
            sumList.mutateSumRange(
                { size: deleteStart },
                { size: deleteStart + deleteSize },
                (valuesStart, values) => {
                    

                    let indexStart = valuesStart?.size || 0;
                    if(indexStart > deleteStart) {
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

        //console.log(linkedListToList(sumList.valueRoot).map(x => ({ ...x.value, size: x.sumIncluded.size })));
    }

    let delta: ArrayDelta = {
        auxOrder: [],
        inserts: [],
        removes: [],
    };
    //todonext;
    // Ugh... wait... this is... we need the indexes of the original ranges, the unchanged ranges changed?
    //  Uh... and then we can infer the deletes (everything not unchanged), and inserts (everything changed, indexes from summing the sizes).
    //  And... we could make a lookup for the deletes and inserts, keeping track of the aux positions, and then pulling
    //  them out when iterating over the inserts, to create an auxOrder.
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

    if(g.TEST) {
        sumList.validateAllNodes();
    }

    return delta;
}