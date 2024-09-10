export type JSONPrimitive = string | number | boolean | null;

export type JSONValue = JSONPrimitive | JSONArray | JSONObject;

export interface JSONObject {
  [key: string]: JSONValue;
}

export type JSONArray = JSONValue[];

export type PathValueMap = Map<string, JSONPrimitive>;

// Returns a map of all the full paths to JSONPrimitives so that it can be used to store them within Store
export function getAllPathFromJsonValue(obj: JSONValue, currentPath: string[] = []): PathValueMap {
  const result: PathValueMap = new Map();
  if (typeof obj !== "object" || obj === null) {
    // If the object is a primitive, add it to the Map
    result.set(currentPath.join(':'), obj as JSONPrimitive);
  } else if (Array.isArray(obj)) {
    // If it's an array, iterate over its elements
    obj.forEach((item, index) => {
      const newPath = [...currentPath, index.toString()];
      const subPaths = getAllPathFromJsonValue(item, newPath);
      subPaths.forEach((value, path) => {
        result.set(path, value);
      });
    });
  } else {
    // If it's an object, iterate over its keys
    for (const key in obj) {
      const newPath = [...currentPath, key];
      const subPaths = getAllPathFromJsonValue(obj[key], newPath);
      subPaths.forEach((value, path) => {
        result.set(path, value);
      });
    }
  }
  return result;
}