import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const BANGKOK_TZ = 'Asia/Bangkok';

export const nowInBangkok = () => dayjs().tz(BANGKOK_TZ);
export const toBangkokIso = (value: Date | string) => dayjs(value).tz(BANGKOK_TZ).format();
