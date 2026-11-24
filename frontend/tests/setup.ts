import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(() => cleanup());

import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 4000 });
