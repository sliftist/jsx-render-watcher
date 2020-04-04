import { SkipList, linkedListToList } from "./SkipList";
import { compareString } from "./algorithms";
import { ThrowIfNotImplementsData } from "pchannel";

describe("SkipList", () => {
    it("test basic", () => {
        let sumList = new SkipList<{ sortOrder: string; }, { sum: number }>(
            (a, b) => ({ sum: a.sum + b.sum }),
            (lhs, rhs) => compareString(lhs.value.sortOrder, rhs.value.sortOrder)
        );
    
        sumList.addNode({ sortOrder: "a" }, { sum: 2 });
        console.log(linkedListToList(sumList.valueRoot).map(x => x.lastValue.sortOrder));
        
        
        sumList.addNode({ sortOrder: "b" }, { sum: 1 });
        console.log(linkedListToList(sumList.valueRoot).map(x => x.lastValue.sortOrder));
        sumList.addNode({ sortOrder: "c" }, { sum: 3 });
        sumList.addNode({ sortOrder: "k" }, { sum: -2 });
        sumList.addNode({ sortOrder: "q" }, { sum: 1 });
        console.log(linkedListToList(sumList.valueRoot).map(x => x.lastValue.sortOrder));
    
        ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "a" })?.sum, undefined);
        console.log(linkedListToList(sumList.valueRoot).map(x => x.lastValue.sortOrder));
        
        ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "b" })?.sum, 2);

        ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "e" })?.sum, 6);
    
        sumList.addNode({ sortOrder: "ba" }, { sum: 1 });
        sumList.addNode({ sortOrder: "aa" }, { sum: 1 });

        //console.log(linkedListToList(sumList.valueRoot as any).map(x => [x.value, x.sumIncluded]));
    
        // a=2,aa=1,b=1, sum = 4
        ThrowIfNotImplementsData(sumList.getSumBefore({ sortOrder: "ba" })?.sum, 4);
    });
});