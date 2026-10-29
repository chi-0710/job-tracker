package com.chi.jobtracker.timeline;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TimelineEventRepository extends JpaRepository<TimelineEvent, UUID> {

    List<TimelineEvent> findByPositionIdOrderByOccurredOnAscCreatedAtAsc(UUID positionId);

    Optional<TimelineEvent> findByIdAndPositionId(UUID id, UUID positionId);
}
