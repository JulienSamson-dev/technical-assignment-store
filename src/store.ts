import { JSONArray, JSONObject, JSONPrimitive, getAllPathFromJsonValue } from "./json-types";
import "reflect-metadata";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

// Defines a Restrict decorator applying to any property or function of a Store extended class in order to define it's access permission
export function Restrict(permission: Permission = "none") {
  return function (target: Store, propertyKey: string): void {
    // If the target wasn't initialized yet we store it inside the metadata associated to this targer
    if (target.permissionMap === undefined) {
      const existingPermissions = Reflect.getMetadata(PERMISSIONS_KEY, target) ?? {};
      existingPermissions[propertyKey] = permission;
      Reflect.defineMetadata(PERMISSIONS_KEY, existingPermissions, target);
    } else target.setPermission(propertyKey, permission);
    // Defines what happens when a property of the store is set
    Object.defineProperty(target, propertyKey, {
      set(newValue: StoreValue) {
        // We don't make any checkups if direct set, otherwise the adminStore constructor would be in error
        if (newValue instanceof Store || typeof newValue === 'function' || typeof newValue === 'string' || typeof newValue === 'number' || typeof newValue === 'boolean' || newValue === null || newValue == undefined) {
          this.storeEntries.set(propertyKey, newValue);
        } else {
          // We make a Store out of the JSONArray or JSONObject to be set inside storeEntries
          const store = this.createInstance();
          const pathValueMap = getAllPathFromJsonValue(newValue);
          pathValueMap.forEach((val, key) => {
            store.write(key, val);
          });
          this.storeEntries.set(propertyKey, store);
        }
      }
    });
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";
  // Stores key-value permissions
  permissionMap: Map<string, Permission> = new Map();
  // Stores entries of the Store in form of StoreResult | (() => StoreResult) to be used by the read() method
  storeEntries: Map<string, StoreResult | (() => StoreResult)> = new Map();

  getPermission(key: string): Permission {
    return this.permissionMap.get(key) ?? this.defaultPolicy;
  }

  setPermission(key: string, permission: Permission): void {
    this.permissionMap.set(key, permission);
  }

  allowedToRead(key: string): boolean {
    const permission = this.getPermission(key);
    return permission.includes('r');
  }

  allowedToWrite(key: string): boolean {
    const permission = this.getPermission(key);
    return permission.includes('w');
  }

  read(path: string): StoreResult {
    if (path === null) throw new Error('Null path forbidden');
    const pathParts = path.split(':');
    if (pathParts.length > 1) {
      // The entry has to be a function returning a Store or a Store itself or we can't dive into it to get the data
      const entry = this.storeEntries.get(pathParts[0]);
      if (typeof entry !== 'function' && !(entry instanceof Store)) throw new Error("The path given is incorrect");
      else if (typeof entry === 'function') {
        const functionResult = entry();
        // It has to be a Store the same way
        if (!(functionResult instanceof Store)) throw new Error("The path given is incorrect");
        // Read the subpath from the found store
        return functionResult.read(pathParts.slice(1).join(':'));
      } else {
        // Read the subpath from the found store
        return entry.read(pathParts.slice(1).join(':'));
      }
    } else if (pathParts.length === 1) {
      // We have direct access to this entry
      if (!this.allowedToRead(path)) throw new Error(`Read access denied for property: ${path}`);
      const entry = this.storeEntries.get(path);
      if (typeof entry === 'function') return entry();
      else return entry;
    }
  }

  write(path: string, value: StoreValue): StoreValue {
    if (path === null) throw new Error('Null path forbidden');
    const pathParts = path.split(':');
    if (pathParts.length > 1) {
      // If we are writing with a path longer than 1 then we need to use a store
      let store = this.storeEntries.get(pathParts[0]);
      if (!store || !(store instanceof Store)) {
        // We need to make a new store
        if (this.allowedToWrite(pathParts[0])) {
          store = this.createInstance();
        } else {
          throw new Error(`Write access denied for property: ${pathParts[0]}`);
        }
      }
      store.write(pathParts.slice(1).join(':'), value);
      this.storeEntries.set(pathParts[0], store);
    } else if (pathParts.length === 1) {
      // We can write the entry directly
      if (!this.allowedToWrite(path)) {
        throw new Error(`Write access denied for property: ${path}`);
      }
      if (typeof value === 'function' || value instanceof Store || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null || value == undefined) {
        this.storeEntries.set(path, value);
      } else {
        // We make a Store out of the JSONArray or JSONObject to be set inside storeEntries
        const store = this.createInstance();
        const pathValueMap = getAllPathFromJsonValue(value);
        pathValueMap.forEach((val, key) => {
          store.write(key, val);
        });
        this.storeEntries.set(path, store);
      }
    }
    return value;
  }

  writeEntries(entries: JSONObject): void {
    Object.entries(entries).forEach(([key, value]) => {
      this.write(key, value);
    });
  }

  entries(): JSONObject {
    const result: JSONObject = {};
    this.storeEntries.forEach((value, key) => {
      if (this.allowedToRead(key)) {
        if (value instanceof Store) result[key] = value.entries();
        else if (value && typeof value === 'function') {
          const functionResult = value();
          if (functionResult instanceof Store) result[key] = functionResult.entries();
          else if (functionResult) result[key] = functionResult;
        } else if (value) result[key] = value;
      }
    });
    return result;
  }

  // Used to create an instance of the same Store extended class as our instance
  createInstance(): Store {
    let current: any = this;
    let prototype = Object.getPrototypeOf(current);
    // Traverse up the prototype chain to find the most specific class
    while (prototype && prototype.constructor !== Object) {
      current = prototype;
      prototype = Object.getPrototypeOf(prototype);
    }
    // Create a new instance of the found class
    return new current.constructor();
  }

  constructor() {
    // Get the permissions stored inside the metadata
    const prototype = Object.getPrototypeOf(this);
    const permissions = (Reflect.getMetadata(PERMISSIONS_KEY, prototype) || {}) as Map<string, Permission>;
    this.permissionMap = new Map(Object.entries(permissions));
    this.storeEntries = new Map();
  }
}

const PERMISSIONS_KEY = Symbol('permissionMap');