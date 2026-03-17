import { format } from "date-fns";

export const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return format(d, 'dd/MM/yyyy');
};
