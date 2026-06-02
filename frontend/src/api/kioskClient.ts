import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

export function createKioskClient(token: string) {
  return axios.create({
    baseURL: API_URL,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
}
