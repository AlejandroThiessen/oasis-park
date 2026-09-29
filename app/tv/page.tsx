import type { Metadata } from 'next';
import { TvBoard } from '@/components/tv-board';
import './tv.css';

export const metadata: Metadata = {
  title: 'Oasis Park · Pantalla de reservas',
  description: 'Pantalla del parque: vista de dron y reservas del día de las palapas, la cancha y el campo de fútbol.',
};

export default function TvPage() {
  return <TvBoard/>;
}
