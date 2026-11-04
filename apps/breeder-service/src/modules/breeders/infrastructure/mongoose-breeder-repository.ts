import { Schema } from 'mongoose';

const certificateSchema = new Schema(
  {
    fileName: { type: String, required: true },
    fileReference: { type: String, required: true },
  },
  { _id: false },
);
