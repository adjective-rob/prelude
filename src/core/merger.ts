import type { StateManager } from './state-manager.js';
import type { Project, Stack, Architecture, Constraints, CodeMap } from '../schema/index.js';

const MAP_FILE = 'map.json';

/**
 * Strategies for merging different types of content
 */

export interface MergeResult<T> {
  merged: T;
  changes: MergeChange[];
}

export interface MergeChange {
  field: string;
  type: 'added' | 'removed' | 'modified' | 'preserved';
  oldValue?: any;
  newValue?: any;
  reason: string;
}

/**
 * Intelligent merger for context updates
 */
export class ContextMerger {
  constructor(private stateManager: StateManager) {}

  /**
   * Merge project context
   */
  mergeProject(existing: Project, inferred: Project): MergeResult<Project> {
    const changes: MergeChange[] = [];
    const merged: Project = { ...inferred };

    // Timestamps are bookkeeping, not content: never tracked, never reported.
    // createdAt is carried forward; updatedAt is set below.
    const timestampFields = ['createdAt', 'updatedAt'];
    if (existing.createdAt) merged.createdAt = existing.createdAt;

    // Always preserve manual fields
    const manualFields = this.stateManager
      .getManualFields('project.json')
      .filter(field => !timestampFields.includes(field));
    
    for (const field of manualFields) {
      const existingValue = this.getNestedValue(existing, field);
      const inferredValue = this.getNestedValue(inferred, field);
      
      if (existingValue !== undefined) {
        this.setNestedValue(merged, field, existingValue);
        
        if (JSON.stringify(existingValue) !== JSON.stringify(inferredValue)) {
          changes.push({
            field,
            type: 'preserved',
            oldValue: inferredValue,
            newValue: existingValue,
            reason: 'Manually edited field preserved',
          });
        }
      }
    }

    // Always preserve certain user-maintained fields.
    // name/description are almost always hand-curated to be richer than inference.
    const preserveFields = ['name', 'description', 'team', 'goals', 'relatedProjects'];
    for (const field of preserveFields) {
      const existingValue = existing[field as keyof Project];
      const inferredValue = inferred[field as keyof Project];
      
      // Only preserve if it exists in existing AND is different from inferred
      if (existingValue !== undefined && existingValue !== null && 
          JSON.stringify(existingValue) !== JSON.stringify(inferredValue)) {
        (merged as any)[field] = existingValue;
        
        changes.push({
          field,
          type: 'preserved',
          newValue: existingValue,
          reason: 'User-maintained field',
        });
      }
    }

    // Check for new inferred changes
    for (const key of Object.keys(inferred) as Array<keyof Project>) {
      if (preserveFields.includes(key as string) || manualFields.includes(key as string) ||
          timestampFields.includes(key as string)) {
        continue;
      }

      const oldValue = existing[key];
      const newValue = inferred[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        if (oldValue === undefined) {
          changes.push({
            field: key as string,
            type: 'added',
            newValue,
            reason: 'New inferred value',
          });
        } else {
          changes.push({
            field: key as string,
            type: 'modified',
            oldValue,
            newValue,
            reason: 'Codebase changed',
          });
        }
      }
    }

    // Update timestamp
    merged.updatedAt = new Date().toISOString();

    return { merged, changes };
  }

  /**
   * Merge stack context
   */
  mergeStack(existing: Stack, inferred: Stack): MergeResult<Stack> {
    const changes: MergeChange[] = [];
    // Start from existing, overlay inferred — preserves fields inference can't produce
    const merged: Stack = { ...existing, ...inferred };

    // Carry forward existing fields that inference returned empty/undefined for
    for (const key of Object.keys(existing) as Array<keyof Stack>) {
      const existingValue = existing[key];
      const inferredValue = inferred[key];

      if (existingValue !== undefined && existingValue !== null) {
        // Inference produced nothing for this field — keep existing
        if (inferredValue === undefined || inferredValue === null) {
          (merged as any)[key] = existingValue;
          changes.push({
            field: key as string,
            type: 'preserved',
            newValue: existingValue,
            reason: 'Existing value preserved (not re-inferred)',
          });
        }
        // Inference produced an empty array/object but existing has content — keep existing
        else if (
          (Array.isArray(inferredValue) && inferredValue.length === 0 &&
           Array.isArray(existingValue) && existingValue.length > 0) ||
          (typeof inferredValue === 'object' && !Array.isArray(inferredValue) &&
           Object.keys(inferredValue as object).length === 0 &&
           typeof existingValue === 'object' && !Array.isArray(existingValue) &&
           Object.keys(existingValue as object).length > 0)
        ) {
          (merged as any)[key] = existingValue;
          changes.push({
            field: key as string,
            type: 'preserved',
            newValue: existingValue,
            reason: 'Existing value preserved (inference returned empty)',
          });
        }
      }
    }

    // Track framework/dep additions and removals
    const existingDeps = new Set([
      ...(existing.frameworks || []),
      ...(existing.buildTools || []),
      ...(existing.testingFrameworks || []),
      ...(existing.styling || []),
    ]);

    const inferredDeps = new Set([
      ...(inferred.frameworks || []),
      ...(inferred.buildTools || []),
      ...(inferred.testingFrameworks || []),
      ...(inferred.styling || []),
    ]);

    for (const dep of existingDeps) {
      if (!inferredDeps.has(dep)) {
        changes.push({
          field: 'dependencies',
          type: 'removed',
          oldValue: dep,
          reason: 'No longer detected in project',
        });
      }
    }

    for (const dep of inferredDeps) {
      if (!existingDeps.has(dep)) {
        changes.push({
          field: 'dependencies',
          type: 'added',
          newValue: dep,
          reason: 'New dependency detected',
        });
      }
    }

    return { merged, changes };
  }

  /**
   * Merge architecture context
   */
  mergeArchitecture(existing: Architecture, inferred: Architecture): MergeResult<Architecture> {
    const changes: MergeChange[] = [];
    const merged: Architecture = { ...inferred };

    // Preserve manual patterns
    const manualFields = this.stateManager.getManualFields('architecture.json');
    
    if (manualFields.includes('patterns')) {
      merged.patterns = existing.patterns;
      changes.push({
        field: 'patterns',
        type: 'preserved',
        newValue: existing.patterns,
        reason: 'Manually specified patterns',
      });
    }

    // Merge directories (new + preserved manual)
    if (existing.directories && inferred.directories) {
      const existingDirPaths = new Set(existing.directories.map(d => d.path));
      const inferredDirPaths = new Set(inferred.directories.map(d => d.path));
      
      // Find removed directories
      for (const dir of existing.directories) {
        if (!inferredDirPaths.has(dir.path)) {
          changes.push({
            field: 'directories',
            type: 'removed',
            oldValue: dir.path,
            reason: 'Directory no longer exists',
          });
        }
      }
      
      // Find new directories
      for (const dir of inferred.directories) {
        if (!existingDirPaths.has(dir.path)) {
          changes.push({
            field: 'directories',
            type: 'added',
            newValue: dir.path,
            reason: 'New directory detected',
          });
        }
      }
    }

    return { merged, changes };
  }

  /**
   * Merge constraints context
   */
  mergeConstraints(existing: Constraints, inferred: Constraints): MergeResult<Constraints> {
    const changes: MergeChange[] = [];
    // Start from existing, overlay inferred — preserves hand-curated fields
    const merged: Constraints = { ...existing, ...inferred };

    // Carry forward existing fields that inference returned empty/undefined for
    for (const key of Object.keys(existing) as Array<keyof Constraints>) {
      const existingValue = existing[key];
      const inferredValue = inferred[key];

      if (existingValue !== undefined && existingValue !== null) {
        if (inferredValue === undefined || inferredValue === null) {
          (merged as any)[key] = existingValue;
        }
        // Preserve non-empty arrays/objects over empty inferred ones
        else if (
          (Array.isArray(inferredValue) && inferredValue.length === 0 &&
           Array.isArray(existingValue) && existingValue.length > 0) ||
          (typeof inferredValue === 'object' && !Array.isArray(inferredValue) &&
           Object.keys(inferredValue as object).length === 0 &&
           typeof existingValue === 'object' && !Array.isArray(existingValue) &&
           Object.keys(existingValue as object).length > 0)
        ) {
          (merged as any)[key] = existingValue;
        }
      }
    }

    // Preserve user-added preferences
    if (existing.preferences && existing.preferences.length > 0) {
      const manualPreferences = existing.preferences.filter(pref =>
        this.stateManager.isManuallyEdited('constraints.json', `preferences.${pref.category}`)
      );

      merged.preferences = [
        ...(inferred.preferences || []),
        ...manualPreferences,
      ];

      if (manualPreferences.length > 0) {
        changes.push({
          field: 'preferences',
          type: 'preserved',
          newValue: manualPreferences,
          reason: 'User-defined preferences preserved',
        });
      }
    }

    // Merge mustUse/mustNotUse (combine inferred + manual)
    // If inference returned nothing, keep all existing items.
    // Otherwise, keep inferred + manually-edited existing items.
    if (existing.mustUse && existing.mustUse.length > 0) {
      const inferredMustUse = inferred.mustUse || [];
      if (inferredMustUse.length === 0) {
        merged.mustUse = existing.mustUse;
      } else {
        const manual = existing.mustUse.filter(item =>
          this.stateManager.isManuallyEdited('constraints.json', `mustUse.${item}`)
        );
        merged.mustUse = [...new Set([...inferredMustUse, ...manual])];
      }
    }

    if (existing.mustNotUse && existing.mustNotUse.length > 0) {
      const inferredMustNotUse = inferred.mustNotUse || [];
      if (inferredMustNotUse.length === 0) {
        merged.mustNotUse = existing.mustNotUse;
      } else {
        const manual = existing.mustNotUse.filter(item =>
          this.stateManager.isManuallyEdited('constraints.json', `mustNotUse.${item}`)
        );
        merged.mustNotUse = [...new Set([...inferredMustNotUse, ...manual])];
      }
    }

    return { merged, changes };
  }

  /**
   * Merge the code map. Inferred structure always wins; hand-written module
   * `notes` and manually edited `purpose` values are carried forward.
   * Only structural changes are reported (modules, file sets, hub order);
   * rank/importedBy/lines/exports churn is deliberately silent.
   */
  mergeMap(existing: CodeMap | undefined, inferred: CodeMap): MergeResult<CodeMap> {
    if (!existing || !Array.isArray(existing.modules)) {
      return {
        merged: inferred,
        changes: [{ field: 'map', type: 'added', reason: 'Code map generated' }],
      };
    }

    const changes: MergeChange[] = [];
    const existingByPath = new Map(existing.modules.map(m => [m.path, m]));
    const inferredPaths = new Set(inferred.modules.map(m => m.path));

    const modules = inferred.modules.map(mod => {
      const prev = existingByPath.get(mod.path);
      if (!prev) {
        changes.push({ field: `modules.${mod.path}`, type: 'added', newValue: mod.path, reason: 'New module detected' });
        return mod;
      }

      const next = { ...mod };
      const purposePath = `modules.${mod.path}.purpose`;
      let keepPurpose = false;

      if (prev.purpose !== undefined && prev.purpose !== mod.purpose) {
        if (this.stateManager.isManuallyEdited(MAP_FILE, purposePath)) {
          keepPurpose = true;
        } else if (
          this.stateManager.getFieldState(MAP_FILE, purposePath) &&
          this.stateManager.hasInferredChanged(MAP_FILE, purposePath, prev.purpose)
        ) {
          // The JSON no longer matches what we last inferred: a hand edit.
          keepPurpose = true;
          this.stateManager.trackManual(MAP_FILE, purposePath, prev.purpose);
        }
      }

      if (keepPurpose) {
        next.purpose = prev.purpose;
        changes.push({
          field: purposePath,
          type: 'preserved',
          oldValue: mod.purpose,
          newValue: prev.purpose,
          reason: 'Manually edited purpose preserved',
        });
      }
      if (prev.notes) next.notes = prev.notes;

      const prevFiles = new Set(prev.files.map(f => f.file));
      const nextFiles = new Set(mod.files.map(f => f.file));
      const removed = [...prevFiles].filter(f => !nextFiles.has(f)).sort();
      const added = [...nextFiles].filter(f => !prevFiles.has(f)).sort();
      if (removed.length > 0 || added.length > 0) {
        changes.push({
          field: `modules.${mod.path}.files`,
          type: 'modified',
          oldValue: removed,
          newValue: added,
          reason: 'Files added or removed',
        });
      }

      return orderModuleKeys(next);
    });

    for (const prev of existing.modules) {
      if (!inferredPaths.has(prev.path)) {
        changes.push({ field: `modules.${prev.path}`, type: 'removed', oldValue: prev.path, reason: 'Module no longer exists' });
      }
    }

    const prevHubs = (existing.hubs ?? []).map(h => h.file);
    const nextHubs = (inferred.hubs ?? []).map(h => h.file);
    if (JSON.stringify(prevHubs) !== JSON.stringify(nextHubs)) {
      changes.push({
        field: 'hubs',
        type: 'modified',
        oldValue: prevHubs.slice(0, 5),
        newValue: nextHubs.slice(0, 5),
        reason: 'Hub ranking changed',
      });
    }

    return { merged: { ...inferred, modules }, changes };
  }

  /**
   * Helper to get nested value by path
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }

  /**
   * Helper to set nested value by path
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((curr, key) => {
      if (!curr[key]) curr[key] = {};
      return curr[key];
    }, obj);
    target[lastKey] = value;
  }
}

/** Keep a stable key order so notes/purpose land next to path in map.json. */
function orderModuleKeys<T extends CodeMap['modules'][number]>(mod: T): T {
  const { path, purpose, notes, fileCount, truncated, files, dependsOn, dependedOnBy, tests, ...rest } = mod;
  return {
    path,
    ...(purpose !== undefined ? { purpose } : {}),
    ...(notes !== undefined ? { notes } : {}),
    fileCount,
    ...(truncated ? { truncated } : {}),
    files,
    ...(dependsOn ? { dependsOn } : {}),
    ...(dependedOnBy ? { dependedOnBy } : {}),
    ...(tests ? { tests } : {}),
    ...rest,
  } as T;
}

/**
 * Track map module purposes in state. Only `modules.<path>.purpose` is
 * tracked; the rest of the map is regenerated wholesale on every update.
 */
export function trackMapFields(stateManager: StateManager, merged: CodeMap, inferred: CodeMap): void {
  const inferredByPath = new Map(inferred.modules.map(m => [m.path, m]));
  for (const mod of merged.modules) {
    const path = `modules.${mod.path}.purpose`;
    const inferredPurpose = inferredByPath.get(mod.path)?.purpose;
    if (mod.purpose === inferredPurpose) {
      stateManager.trackInferred(MAP_FILE, path, mod.purpose ?? null);
    } else {
      stateManager.trackManual(MAP_FILE, path, mod.purpose ?? null);
    }
  }
}
