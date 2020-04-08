import { AATree } from "./AATree";

// TODO: We should store blocks in AATree, that way instead of every element having a node
//  we can store up to maybe 128 elements in a node. 
//  - This would require AATree supporting some kind of "mutateRange", where we can take a range
//      and mutate it all at once.

export class AATreeArray<T> {
    tree = new AATree<T, number>(
        (lhs, rhs) => lhs.beforeSum - rhs.beforeSum,
        x => 1,
        (lhs, rhs) => lhs + rhs,
        0
    );
    public Insert(index: number, value: T): void {
        if(index < 0) {
            throw new Error(`Negative insert indexes are invalid in AATreeArray, ${index}`);
        }
        let len = this.GetLength();
        if(index > len) {
            index = len;
        }
        this.tree.Add(value, index);
    }
    public Get(index: number): T|undefined {
        let node = this.tree.Find(null as any as T, index);
        return node?.value;
    }
    public GetLength(): number {
        return this.tree.GetRootSum();
    }
    public Remove(index: number): void {
        if(index < 0) {
            throw new Error(`Negative remove indexes are invalid in AATreeArray, ${index}`);
        }
        let len = this.GetLength();
        if(index > len) return;
        this.tree.Remove(null as any as T, index);
    }
}