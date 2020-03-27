
type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

declare namespace EyeTypes {
    type Path2 = DeepReadonly<{
        /** The access path. */
        path: (string|symbol|number)[];
        /** Paths hashes are comparable via regular comparison operators. Also, the root path is truthy, and we can get the parent of a path without
         *      having to worry about escape characters, so path navigation is relatively fast.
         */
        pathHash: string;
    }>;

    type ExposedLookup = { [key in PropertyKey]: object };
}

interface Window {
    __exposeExposedLookups: {
        [name: string]: {
            lookup: EyeTypes.ExposedLookup;
            setLookup: (newLookup: EyeTypes.ExposedLookup) => void;
        }
    };
    __connectToDebugUtils(): void;

    __launchDebugUtils(): Promise<void>;
}