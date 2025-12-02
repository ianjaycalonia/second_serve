<?php
require_once __DIR__ . '/../includes/config.php';

class SchedulingAlgorithm
{
    public static function startOfWeek(DateTime $date): DateTime
    {
        // Use the exact provided date as start of a 7-day window (no ISO alignment)
        $d = clone $date; $d->setTime(0,0,0);
        return $d;
    }

    public static function upcomingWeeks(DateTime $baseDate, int $count = 4): array
    {
        $base = self::startOfWeek($baseDate);
        $out = [];
        for ($i=0; $i<$count; $i++){
            $d = (clone $base)->modify('+' . (7*$i) . ' day');
            $out[] = [
                'year' => (int)$d->format('Y'),
                'month' => (int)$d->format('n'),
                'week' => $i+1,
                'start_date' => $d->format('Y-m-d'),
            ];
        }
        return $out;
    }
}
