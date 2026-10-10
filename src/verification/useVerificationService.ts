import { useMemo } from 'react';
import { useServices } from '@/services/ServicesProvider';
import { useStore } from '@/store/AppStore';
import { createVerificationService } from './engine';

/** The verification service for the signed-in administrator, as used by the FixID web verifier. */
export function useVerificationService() {
  const { getState, dispatch } = useStore();
  const { idSwitch, faceVerification } = useServices();
  return useMemo(() => createVerificationService({ getState, dispatch, idSwitch, faceVerification }), [getState, dispatch, idSwitch, faceVerification]);
}
