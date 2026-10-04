import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PickedFile } from '@/data/source';

/** The camera is offered on phones and tablets only; browsers fall back to the photo library. */
export const CAN_USE_CAMERA = Platform.OS !== 'web';

let photoCount = 0;

/**
 * Let the person choose a photo from their library or take one with the camera.
 * Returns null if they cancel. Throws if permission is refused, so the caller can explain.
 */
export async function pickPhoto(from: 'library' | 'camera'): Promise<PickedFile | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false };
  let result: ImagePicker.ImagePickerResult;
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Please allow camera access in Settings to photograph your work.');
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Please allow photo library access in Settings to add a photo.');
    }
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  photoCount += 1;
  return {
    name: asset.fileName ?? `photo-${photoCount}.jpg`,
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    file: asset.file ?? undefined,
  };
}
