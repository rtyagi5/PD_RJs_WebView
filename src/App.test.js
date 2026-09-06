// The original CRA stub asserted on a "learn react" link that this app has never
// rendered, so it failed on every run. Replaced with real smoke tests of the two
// entry paths: no/invalid token, and a token that leaves the exercise unspecified
// (which is what surfaces the manual picker).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { EXERCISE_CONFIGS } from './dtw/specToReference';

// axios ships ESM, which Jest does not transform inside node_modules.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

// The tracker pulls in tfjs / the webcam and is not the subject of this test.
jest.mock('./ExerciseTracker_refactored', () => () => <div data-testid="tracker" />);

jest.mock('jwt-decode', () => ({ jwtDecode: jest.fn() }));

const axios = require('axios');
const { jwtDecode } = require('jwt-decode');

// App reads the JWT from the query string via useLocation(), so it needs a Router.
const renderApp = () => render(<MemoryRouter><App /></MemoryRouter>);

// NOTE: CRA enables Jest's `resetMocks`, which strips implementations before every
// test — so they must be (re)installed here rather than in the jest.mock factory.
// The repo's .env sets REACT_APP_DEVELOPMENT_MODE=true and CRA loads .env during
// tests, so each test states explicitly which entry path it is exercising.
const ORIGINAL_DEV_MODE = process.env.REACT_APP_DEVELOPMENT_MODE;

beforeEach(() => {
  axios.get.mockResolvedValue({ data: { data: { status: 'assigned' } } });
  process.env.REACT_APP_DEVELOPMENT_MODE = 'false';
});

afterAll(() => {
  process.env.REACT_APP_DEVELOPMENT_MODE = ORIGINAL_DEV_MODE;
});

describe('App shell', () => {
  it('shows a support message when there is no usable token', async () => {
    jwtDecode.mockImplementation(() => { throw new Error('no token'); });
    renderApp();
    expect(await screen.findByText(/contact support/i)).toBeInTheDocument();
  });

  it('shows the manual picker when the token omits the exercise', async () => {
    // A decodable token whose payload has no reps/exerciseType leaves the app
    // idle, which is the path that renders the manual start form.
    jwtDecode.mockReturnValue({ tenant: 'clinic', activity: 'act-1' });
    renderApp();
    expect(await screen.findByRole('button', { name: /start exercise/i })).toBeInTheDocument();
  });

  it('offers every configured exercise in the picker', async () => {
    jwtDecode.mockReturnValue({ tenant: 'clinic', activity: 'act-1' });
    renderApp();
    await screen.findByRole('button', { name: /start exercise/i });

    const values = Array.from(document.querySelectorAll('option')).map(o => o.value);

    // Every exercise the DTW engine knows about must be reachable from the picker,
    // otherwise it can never be selected for local testing.
    const missing = Object.keys(EXERCISE_CONFIGS).filter(name => !values.includes(name));
    expect(missing).toEqual([]);
  });
});

describe('development mode', () => {
  // Lets the exercise be driven locally with no JWT and no backend, which is how
  // a newly recorded reference gets validated against a real webcam.
  it('starts the configured exercise immediately without a token', async () => {
    process.env.REACT_APP_DEVELOPMENT_MODE = 'true';
    process.env.REACT_APP_DEFAULT_EXERCISE = 'SideArmRaise';
    jwtDecode.mockImplementation(() => { throw new Error('no token'); });

    renderApp();

    expect(await screen.findByTestId('tracker')).toBeInTheDocument();
    // It must not have contacted the backend at all.
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('stays on the JWT path when development mode is off', async () => {
    process.env.REACT_APP_DEVELOPMENT_MODE = 'false';
    jwtDecode.mockImplementation(() => { throw new Error('no token'); });
    renderApp();
    expect(await screen.findByText(/contact support/i)).toBeInTheDocument();
  });
});
