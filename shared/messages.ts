import type {
  ExtensionState,
  LibraryTest,
  StepType,
  TestCase,
  TestFolder,
  TestLibrary,
  TestStep,
} from './types';

export const MessageType = {
  // UI → Background
  START_RECORDING: 'START_RECORDING',
  STOP_RECORDING: 'STOP_RECORDING',
  START_PLAYBACK: 'START_PLAYBACK',
  STOP_PLAYBACK: 'STOP_PLAYBACK',
  GET_STATE: 'GET_STATE',
  SAVE_TEST: 'SAVE_TEST',
  LOAD_TEST: 'LOAD_TEST',
  CLEAR_STEPS: 'CLEAR_STEPS',
  ADD_STEP: 'ADD_STEP',
  REORDER_STEPS: 'REORDER_STEPS',
  UPDATE_STEP: 'UPDATE_STEP',
  DELETE_STEP: 'DELETE_STEP',
  UPDATE_TEST_NAME: 'UPDATE_TEST_NAME',

  // Library
  CREATE_FOLDER: 'CREATE_FOLDER',
  RENAME_FOLDER: 'RENAME_FOLDER',
  DELETE_FOLDER: 'DELETE_FOLDER',
  CREATE_TEST: 'CREATE_TEST',
  OPEN_TEST: 'OPEN_TEST',
  DELETE_TEST: 'DELETE_TEST',
  DUPLICATE_TEST: 'DUPLICATE_TEST',
  MOVE_TEST: 'MOVE_TEST',
  MOVE_FOLDER: 'MOVE_FOLDER',
  RENAME_TEST: 'RENAME_TEST',
  IMPORT_LIBRARY: 'IMPORT_LIBRARY',
  IMPORT_FOLDER: 'IMPORT_FOLDER',

  // Element picker
  START_ELEMENT_PICK: 'START_ELEMENT_PICK',
  CANCEL_ELEMENT_PICK: 'CANCEL_ELEMENT_PICK',
  SET_PICK_ACTIVE: 'SET_PICK_ACTIVE',
  ELEMENT_PICKED: 'ELEMENT_PICKED',

  // Background → Content
  SET_MODE: 'SET_MODE',
  RUN_STEP: 'RUN_STEP',
  CANCEL_PLAYBACK: 'CANCEL_PLAYBACK',

  // Content → Background
  STEP_RECORDED: 'STEP_RECORDED',
  STEP_RESULT: 'STEP_RESULT',

  // Background → UI broadcast
  STATE_CHANGED: 'STATE_CHANGED',
} as const;

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

export type ExtensionMessage =
  | { type: typeof MessageType.START_RECORDING }
  | { type: typeof MessageType.STOP_RECORDING }
  | { type: typeof MessageType.START_PLAYBACK }
  | { type: typeof MessageType.STOP_PLAYBACK }
  | { type: typeof MessageType.GET_STATE }
  | { type: typeof MessageType.SAVE_TEST; testCase: TestCase }
  | { type: typeof MessageType.LOAD_TEST; testCase: TestCase; folderId?: string | null }
  | { type: typeof MessageType.CLEAR_STEPS }
  | {
      type: typeof MessageType.ADD_STEP;
      stepType: StepType;
      selectors?: string[];
      value?: string | null;
      url?: string | null;
      /** Insert at this index; omit or null to append. */
      index?: number | null;
    }
  | {
      type: typeof MessageType.REORDER_STEPS;
      fromIndex: number;
      toIndex: number;
    }
  | {
      type: typeof MessageType.UPDATE_STEP;
      stepId: string;
      patch: Partial<Pick<TestStep, 'type' | 'selectors' | 'value' | 'url'>>;
    }
  | { type: typeof MessageType.DELETE_STEP; stepId: string }
  | { type: typeof MessageType.UPDATE_TEST_NAME; name: string }
  | {
      type: typeof MessageType.CREATE_FOLDER;
      name: string;
      parentId?: string | null;
    }
  | { type: typeof MessageType.RENAME_FOLDER; folderId: string; name: string }
  | { type: typeof MessageType.DELETE_FOLDER; folderId: string }
  | {
      type: typeof MessageType.CREATE_TEST;
      name?: string;
      folderId?: string | null;
    }
  | { type: typeof MessageType.OPEN_TEST; testId: string }
  | { type: typeof MessageType.DELETE_TEST; testId: string }
  | { type: typeof MessageType.DUPLICATE_TEST; testId: string }
  | {
      type: typeof MessageType.MOVE_TEST;
      testId: string;
      folderId: string | null;
    }
  | {
      type: typeof MessageType.MOVE_FOLDER;
      folderId: string;
      parentId: string | null;
    }
  | { type: typeof MessageType.RENAME_TEST; testId: string; name: string }
  | { type: typeof MessageType.IMPORT_LIBRARY; library: TestLibrary }
  | {
      type: typeof MessageType.IMPORT_FOLDER;
      /** Parent folder to nest under; null = top-level. */
      parentId: string | null;
      folders: TestFolder[];
      tests: LibraryTest[];
    }
  | { type: typeof MessageType.START_ELEMENT_PICK }
  | { type: typeof MessageType.CANCEL_ELEMENT_PICK }
  | { type: typeof MessageType.SET_PICK_ACTIVE; active: boolean }
  | { type: typeof MessageType.ELEMENT_PICKED; selectors: string[] }
  | {
      type: typeof MessageType.SET_MODE;
      mode: ExtensionState['mode'];
    }
  | { type: typeof MessageType.RUN_STEP; step: TestStep }
  | { type: typeof MessageType.CANCEL_PLAYBACK }
  | { type: typeof MessageType.STEP_RECORDED; step: TestStep }
  | {
      type: typeof MessageType.STEP_RESULT;
      ok: boolean;
      error?: string;
      navigated?: boolean;
    }
  | { type: typeof MessageType.STATE_CHANGED; state: ExtensionState };

export type MessageResponse =
  | { ok: true; state?: ExtensionState }
  | { ok: false; error: string }
  | ExtensionState
  | {
      ok: boolean;
      error?: string;
      navigated?: boolean;
    }
  | undefined;
