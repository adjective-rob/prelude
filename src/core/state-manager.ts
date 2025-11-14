import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { PreludeState, FileState, FieldState } from '../schema/state.js';
import { createInitialState, trackField } from '../schema/state.js';
import { ensureDir } from '../utils/fs.js';

const STATE_DIR = '.context/.prelude';
const STATE_FILE = join(STATE_DIR, 'state.json');
const HISTORY_DIR = join(STATE_DIR, 'history');

/**
 * Manages Prelude state tracking
 */
export class StateManager {
  private state: PreludeState;
  private contextDir: string;

  constructor(contextDir: string = '.context') {
    this.contextDir = contextDir;
    this.state = this.loadState();
  }

  /**
   * Load state from disk or create new
   */
  private loadState(): PreludeState {
    const statePath = join(this.contextDir, '.prelude', 'state.json');
    
    if (existsSync(statePath)) {
      try {
        const content = readFileSync(statePath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        console.warn('Failed to load state, creating new:', error);
      }
    }
    
    return createInitialState();
  }

  /**
   * Save state to disk
   */
  save(): void {
    const stateDir = join(this.contextDir, '.prelude');
    const statePath = join(stateDir, 'state.json');
    
    // Ensure directories exist
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    
    // Update timestamp
    this.state.lastUpdate = new Date().toISOString();
    
    // Write state
    writeFileSync(statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Create backup of current state
   */
  backup(): void {
    const historyDir = join(this.contextDir, '.prelude', 'history');
    
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const backupPath = join(historyDir, `${timestamp}.json`);
    
    writeFileSync(backupPath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Hash a value for change detection
   */
  private hash(value: any): string {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Track a field as inferred
   */
  trackInferred(file: string, fieldPath: string, value: any): void {
    const fileState = this.getOrCreateFileState(file);
    const valueHash = this.hash(value);
    
    fileState.fields[fieldPath] = trackField(value, 'inferred', valueHash);
    fileState.lastUpdated = new Date().toISOString();
  }

  /**
   * Track a field as manually edited
   */
  trackManual(file: string, fieldPath: string, value: any): void {
    const fileState = this.getOrCreateFileState(file);
    
    fileState.fields[fieldPath] = trackField(value, 'manual');
    fileState.lastUpdated = new Date().toISOString();
  }

  /**
   * Check if a field was manually edited
   */
  isManuallyEdited(file: string, fieldPath: string): boolean {
    const fileState = this.getFileState(file);
    if (!fileState) return false;
    
    const fieldState = fileState.fields[fieldPath];
    return fieldState?.source === 'manual';
  }

  /**
   * Check if inferred value changed
   */
  hasInferredChanged(file: string, fieldPath: string, newValue: any): boolean {
    const fileState = this.getFileState(file);
    if (!fileState) return true;
    
    const fieldState = fileState.fields[fieldPath];
    if (!fieldState) return true;
    
    const newHash = this.hash(newValue);
    return fieldState.inferredHash !== newHash;
  }

  /**
   * Get field state
   */
  getFieldState(file: string, fieldPath: string): FieldState | undefined {
    const fileState = this.getFileState(file);
    return fileState?.fields[fieldPath];
  }

  /**
   * Get file state
   */
  private getFileState(file: string): FileState | undefined {
    return this.state.files.find(f => f.file === file);
  }

  /**
   * Get or create file state
   */
  private getOrCreateFileState(file: string): FileState {
    let fileState = this.getFileState(file);
    
    if (!fileState) {
      fileState = {
        file,
        lastUpdated: new Date().toISOString(),
        fields: {},
      };
      this.state.files.push(fileState);
    }
    
    return fileState;
  }

  /**
   * Get all manually edited fields for a file
   */
  getManualFields(file: string): string[] {
    const fileState = this.getFileState(file);
    if (!fileState) return [];
    
    return Object.entries(fileState.fields)
      .filter(([_, state]) => state.source === 'manual')
      .map(([path, _]) => path);
  }

  /**
   * Get current state
   */
  getState(): PreludeState {
    return this.state;
  }
}