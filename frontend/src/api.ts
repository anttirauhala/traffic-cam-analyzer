import axios from 'axios';
import type {
  ListCamerasResponse,
  ListDetectionsResponse,
  GetImageUrlResponse,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://8qzkddzhs7.execute-api.eu-north-1.amazonaws.com/dev';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const getCameras = async (): Promise<ListCamerasResponse> => {
  const { data } = await api.get<ListCamerasResponse>('/cameras');
  return data;
};

export const getDetections = async (params: {
  cameraId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ListDetectionsResponse> => {
  const { data } = await api.get<ListDetectionsResponse>('/detections', { params });
  return data;
};

export const getImageUrl = async (bucket: 'raw' | 'processed', key: string): Promise<string> => {
  const { data } = await api.get<GetImageUrlResponse>('/images', {
    params: { bucket, key },
  });
  return data.url;
};
